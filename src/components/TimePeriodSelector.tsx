import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Calendar, Clock, CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import { RequestFrequency } from '@/types/dashboard';
import { getCurrentYear, getPeriodsForFrequency, isYearInRange } from '@/utils/dateUtils';
import { getFrequencyColor } from '@/utils/documentUtils';
import { TIME_RANGES } from '@/constants/app';

interface TimePeriodSelectorProps {
  isOpen: boolean;
  onClose: () => void;
  documentName: string;
  frequency: RequestFrequency;
  onSave: (selectedPeriods: string[]) => void;
  initialSelected?: string[];
}

const TimePeriodSelector: React.FC<TimePeriodSelectorProps> = ({
  isOpen,
  onClose,
  documentName,
  frequency,
  onSave,
  initialSelected = []
}) => {
  const [selectedPeriods, setSelectedPeriods] = useState<string[]>(initialSelected);
  const [selectedYear, setSelectedYear] = useState<number>(new Date().getFullYear());

  useEffect(() => {
    setSelectedPeriods(initialSelected);
  }, [initialSelected]);

  const currentYear = getCurrentYear();

  const getPeriods = () => {
    return getPeriodsForFrequency(frequency, selectedYear);
  };

  const getFrequencyIcon = () => {
    switch (frequency) {
      case 'monthly':
        return <Calendar className="h-4 w-4 text-blue-600" />;
      case 'quarterly':
        return <Clock className="h-4 w-4 text-purple-600" />;
      case 'yearly':
        return <CalendarDays className="h-4 w-4 text-green-600" />;
      default:
        return <Calendar className="h-4 w-4 text-gray-600" />;
    }
  };



  const togglePeriod = (periodValue: string) => {
    setSelectedPeriods(prev => 
      prev.includes(periodValue)
        ? prev.filter(p => p !== periodValue)
        : [...prev, periodValue]
    );
  };

  const selectAll = () => {
    const allPeriods = getPeriods().map(p => p.value);
    setSelectedPeriods(prev => {
      const existingPeriods = prev.filter(p => !p.startsWith(`${selectedYear}-`));
      return [...existingPeriods, ...allPeriods];
    });
  };

  const clearAll = () => {
    setSelectedPeriods(prev => prev.filter(p => !p.startsWith(`${selectedYear}-`)));
  };

  const selectAllYears = () => {
    const allPeriods: string[] = [];
    for (let year = currentYear - TIME_RANGES.YEAR_RANGE_PAST; year <= currentYear + TIME_RANGES.YEAR_RANGE_FUTURE; year++) {
      if (frequency === 'monthly') {
        for (let month = 1; month <= 12; month++) {
          allPeriods.push(`${year}-${String(month).padStart(2, '0')}`);
        }
      } else if (frequency === 'quarterly') {
        allPeriods.push(`${year}-Q1`, `${year}-Q2`, `${year}-Q3`, `${year}-Q4`);
      }
    }
    setSelectedPeriods(allPeriods);
  };

  const clearAllYears = () => {
    setSelectedPeriods([]);
  };

  const handleSave = () => {
    onSave(selectedPeriods);
    onClose();
  };

  const navigateYear = (direction: 'prev' | 'next') => {
    setSelectedYear(prev => {
      const newYear = direction === 'prev' ? prev - 1 : prev + 1;
      return isYearInRange(newYear) ? newYear : prev;
    });
  };

  const periods = getPeriods();
  const hasYearNavigation = frequency === 'monthly' || frequency === 'quarterly';

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            {getFrequencyIcon()}
            <div>
              <div className="text-lg font-semibold">Select Time Periods</div>
              <div className="text-sm font-normal text-gray-600">
                {documentName} - {frequency.charAt(0).toUpperCase() + frequency.slice(1)} frequency
              </div>
            </div>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          {/* Frequency Badge */}
          <div className="flex items-center gap-2">
            <Badge className={getFrequencyColor(frequency)}>
              {frequency.charAt(0).toUpperCase() + frequency.slice(1)}
            </Badge>
            <span className="text-sm text-gray-600">
              Select which {frequency === 'monthly' ? 'months' : frequency === 'quarterly' ? 'quarters' : 'years'} you need this document for
            </span>
          </div>

          {/* Year Navigation (for monthly and quarterly) */}
          {hasYearNavigation && (
            <div className="bg-gray-50 rounded-lg p-4">
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-sm font-medium text-gray-700">Select Year</h4>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setSelectedYear(currentYear)}
                    className="text-xs"
                  >
                    Current Year
                  </Button>
                </div>
              </div>
              
              <div className="flex items-center justify-center gap-4">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => navigateYear('prev')}
                  disabled={!isYearInRange(selectedYear - 1)}
                  className="h-8 w-8 p-0"
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                
                <div className="text-lg font-semibold text-gray-900 min-w-[80px] text-center">
                  {selectedYear}
                </div>
                
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => navigateYear('next')}
                  disabled={!isYearInRange(selectedYear + 1)}
                  className="h-8 w-8 p-0"
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
              
              <div className="flex justify-center mt-2">
                <div className="text-xs text-gray-500">
                  {currentYear - TIME_RANGES.YEAR_RANGE_PAST} - {currentYear + TIME_RANGES.YEAR_RANGE_FUTURE}
                </div>
              </div>
            </div>
          )}

          {/* Selection Controls */}
          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              size="sm"
              onClick={selectAll}
              className="text-xs"
            >
              Select All {hasYearNavigation ? `(${selectedYear})` : ''}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={clearAll}
              className="text-xs"
            >
              Clear All {hasYearNavigation ? `(${selectedYear})` : ''}
            </Button>
            {hasYearNavigation && (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={selectAllYears}
                  className="text-xs"
                >
                  Select All Years
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={clearAllYears}
                  className="text-xs"
                >
                  Clear All Years
                </Button>
              </>
            )}
            <div className="ml-auto text-sm text-gray-600">
              {selectedPeriods.length} selected
            </div>
          </div>

          {/* Periods Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 max-h-80 overflow-y-auto">
            {periods.map((period) => (
              <div
                key={period.value}
                className={`p-3 rounded-lg border-2 cursor-pointer transition-all duration-200 hover:scale-105 ${
                  selectedPeriods.includes(period.value)
                    ? 'border-blue-500 bg-blue-50 shadow-md'
                    : 'border-gray-200 bg-white hover:border-gray-300'
                }`}
                onClick={() => togglePeriod(period.value)}
              >
                <div className="text-center">
                  <div className={`font-medium ${
                    selectedPeriods.includes(period.value)
                      ? 'text-blue-700'
                      : 'text-gray-700'
                  }`}>
                    {period.shortLabel}
                  </div>
                  <div className={`text-xs mt-1 ${
                    selectedPeriods.includes(period.value)
                      ? 'text-blue-600'
                      : 'text-gray-500'
                  }`}>
                    {period.label}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Selected Periods Summary */}
          {selectedPeriods.length > 0 && (
            <div className="space-y-3">
              <div className="text-sm font-medium text-gray-700">Selected Periods:</div>
              <div className="flex flex-wrap gap-2 max-h-32 overflow-y-auto">
                {selectedPeriods.map((period) => {
                  const periodInfo = periods.find(p => p.value === period);
                  const isCurrentYear = period.startsWith(`${selectedYear}-`);
                  
                  return (
                    <Badge
                      key={period}
                      variant="secondary"
                      className={`${
                        isCurrentYear 
                          ? 'bg-blue-100 text-blue-800 border-blue-200' 
                          : 'bg-gray-100 text-gray-700 border-gray-200'
                      }`}
                    >
                      {periodInfo?.shortLabel || period}
                      {!isCurrentYear && (
                        <span className="ml-1 text-xs opacity-75">
                          ({period.split('-')[0]})
                        </span>
                      )}
                    </Badge>
                  );
                })}
              </div>
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex justify-end gap-3 pt-4 border-t">
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button 
              onClick={handleSave}
              disabled={selectedPeriods.length === 0}
              className="bg-blue-600 hover:bg-blue-700"
            >
              Save Selection ({selectedPeriods.length})
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default TimePeriodSelector;
