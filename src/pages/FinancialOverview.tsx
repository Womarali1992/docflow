import React, { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Calendar as CalendarIcon } from 'lucide-react';
import { useDocumentsStore } from '@/context/DocumentsContext';
import { mockClients } from '@/utils/mockData';
import { Document, RequestFrequency } from '@/types/dashboard';
import { Calendar as CalendarUI } from '@/components/ui/calendar';
import { Link } from 'react-router-dom';

const getNextDueDate = (uploadedAt: Date, frequency?: RequestFrequency, explicit?: Date | undefined) => {
  if (explicit) return explicit;
  if (!frequency || frequency === 'one-time') return undefined;
  const next = new Date(uploadedAt);
  switch (frequency) {
    case 'daily':
      next.setDate(next.getDate() + 1);
      break;
    case 'monthly':
      next.setMonth(next.getMonth() + 1);
      break;
    case 'quarterly':
      next.setMonth(next.getMonth() + 3);
      break;
    case 'yearly':
      next.setFullYear(next.getFullYear() + 1);
      break;
    default:
      return undefined;
  }
  return next;
};

const FinancialOverview = () => {
  const { documents } = useDocumentsStore();
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(new Date());
  const [selectedClientIds, setSelectedClientIds] = useState<Set<string>>(new Set());

  const now = new Date();
  const soonThreshold = new Date();
  soonThreshold.setDate(now.getDate() + 14);

  const documentsWithDue = useMemo(() => {
    return documents
      .map((d) => ({
        doc: d,
        due: getNextDueDate(d.uploadedAt, d.requestFrequency, d.dueDate),
      }))
      .filter((x) => x.due);
  }, [documents]);

  const overdue = documentsWithDue.filter((x) => x.due! < now);
  const dueSoon = documentsWithDue.filter((x) => x.due! >= now && x.due! <= soonThreshold);
  const pendingRequests = documents.filter((d) => d.isRequested && !d.url);

  const clientIdToClient = useMemo(() => {
    const map = new Map<string, typeof mockClients[number]>();
    mockClients.forEach((c) => map.set(c.id, c));
    return map;
  }, []);

  const clientRows = useMemo(() => {
    return mockClients.map((client) => {
      const clientDocs: Document[] = documents.filter((d) => d.clientId === client.id);
      const clientDue = clientDocs
        .map((d) => ({ doc: d, due: getNextDueDate(d.uploadedAt, d.requestFrequency, d.dueDate) }))
        .filter((x) => x.due);
      const clientOverdue = clientDue.filter((x) => x.due! < now).length;
      const clientDueSoon = clientDue.filter((x) => x.due! >= now && x.due! <= soonThreshold).length;
      return {
        client,
        documentsCount: clientDocs.length,
        pendingUpdates: client.pendingUpdates,
        unreadMessages: client.unreadMessages,
        dueSoon: clientDueSoon,
        overdue: clientOverdue,
      };
    });
  }, [documents]);

  const upcoming = useMemo(() => {
    return documentsWithDue
      .sort((a, b) => a.due!.getTime() - b.due!.getTime())
      .slice(0, 8)
      .map((x) => ({
        ...x,
        client: x.doc.clientId ? clientIdToClient.get(x.doc.clientId) : undefined,
      }));
  }, [documentsWithDue, clientIdToClient]);

  // Apply client filter to calendar-specific data
  const filteredDocuments = useMemo(() => {
    if (selectedClientIds.size === 0) return documents;
    return documents.filter(d => d.clientId && selectedClientIds.has(d.clientId));
  }, [documents, selectedClientIds]);

  const calendarEvents = useMemo(() => {
    return filteredDocuments
      .map((d) => {
        const due = getNextDueDate(d.uploadedAt, d.requestFrequency, d.dueDate);
        if (!due) return null;
        return {
          id: d.id,
          date: new Date(due.getFullYear(), due.getMonth(), due.getDate()),
          title: d.name,
        };
      })
      .filter(Boolean) as { id: string; date: Date; title: string }[];
  }, [filteredDocuments]);

  // Build event lookup for rendering inside calendar cells
  const eventsByDay = useMemo(() => {
    const map = new Map<string, { id: string; title: string }[]>();
    for (const e of calendarEvents) {
      const key = e.date.toDateString();
      const list = map.get(key) ?? [];
      list.push({ id: e.id, title: e.title });
      map.set(key, list);
    }
    return map;
  }, [calendarEvents]);

  const DayContent = React.useCallback(({ date }: { date: Date }) => {
    const key = date.toDateString();
    const events = eventsByDay.get(key) ?? [];
    const maxItems = 3;
    return (
      <div className="flex h-full w-full flex-col items-start justify-start p-1">
        <div className="text-[11px] leading-none font-medium text-slate-700 mb-1">{date.getDate()}</div>
        <div className="flex-1 w-full space-y-1 overflow-hidden">
          {events.slice(0, maxItems).map((ev) => (
            <div key={ev.id} className="w-full truncate rounded bg-amber-100 text-amber-900 border border-amber-200 px-1 py-0.5 text-[10px]">
              {ev.title}
            </div>
          ))}
          {events.length > maxItems && (
            <div className="text-[10px] text-slate-500">+{events.length - maxItems} more</div>
          )}
        </div>
      </div>
    );
  }, [eventsByDay]);

  const toggleClient = (clientId: string) => {
    setSelectedClientIds(prev => {
      const next = new Set(prev);
      if (next.has(clientId)) next.delete(clientId); else next.add(clientId);
      return next;
    });
  };

  const clearClientFilters = () => setSelectedClientIds(new Set());

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-50">
      <div className="max-w-7xl mx-auto p-6 space-y-6">
        {/* Central Calendar with side client filters and event list */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-slate-900">
              <CalendarIcon className="h-5 w-5" /> Calendar
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-6 lg:grid-cols-12">
              {/* Left: client filter badges */}
              <div className="lg:col-span-2">
              <div className="mb-3 flex flex-wrap gap-2 lg:flex-col lg:flex-nowrap">
                  <Badge
                    onClick={clearClientFilters}
                    className={`cursor-pointer w-full h-10 items-center px-3 ${selectedClientIds.size === 0 ? 'bg-slate-900 text-white hover:bg-slate-900' : 'bg-slate-100 text-slate-700 border-slate-200'}`}
                  >
                    All Clients
                  </Badge>
                  {mockClients.map((c) => {
                    const selected = selectedClientIds.has(c.id);
                    return (
                      <Badge
                        key={c.id}
                        onClick={() => toggleClient(c.id)}
                        className={`cursor-pointer w-full h-10 items-center justify-between px-3 ${selected ? 'bg-blue-600 text-white hover:bg-blue-600' : 'bg-blue-50 text-blue-800 border-blue-200'}`}
                        title={`Filter by ${c.name}`}
                      >
                        <span className="truncate max-w-[140px]">{c.name}</span>
                      </Badge>
                    );
                  })}
                </div>

                {/* Summary badges under client badges */}
                <div className="mt-4 flex flex-col gap-2">
                  <Badge className="w-full h-10 items-center justify-between px-3 bg-slate-100 text-slate-800 border-slate-200">
                    <span className="text-sm">Total Clients</span>
                    <span className="text-sm font-semibold">{mockClients.length}</span>
                  </Badge>
                  <Badge className="w-full h-10 items-center justify-between px-3 bg-amber-100 text-amber-800 border-amber-200">
                    <span className="text-sm">Due Soon (14d)</span>
                    <span className="text-sm font-semibold">{dueSoon.length}</span>
                  </Badge>
                  <Badge className="w-full h-10 items-center justify-between px-3 bg-red-100 text-red-800 border-red-200">
                    <span className="text-sm">Overdue</span>
                    <span className="text-sm font-semibold">{overdue.length}</span>
                  </Badge>
                  <Badge className="w-full h-10 items-center justify-between px-3 bg-blue-100 text-blue-800 border-blue-200">
                    <span className="text-sm">Pending Requests</span>
                    <span className="text-sm font-semibold">{pendingRequests.length}</span>
                  </Badge>
                </div>
              </div>

              {/* Center: large calendar with inline day content */}
              <div className="lg:col-span-10 rounded-lg border p-2 lg:p-4 overflow-x-auto">
                <CalendarUI
                  mode="single"
                  numberOfMonths={1}
                  selected={selectedDate}
                  onSelect={setSelectedDate}
                  components={{
                    DayContent: DayContent as any,
                  }}
                  classNames={{
                    head_row: "flex w-full",
                    // Responsive cell sizing for mobile and up
                    head_cell: "flex-1 text-center text-[0.8rem] text-muted-foreground",
                    day: "w-full h-full p-0 font-normal aria-selected:opacity-100 text-left",
                    cell: "flex-1 min-h-16 sm:min-h-20 md:min-h-28 min-w-[110px] md:min-w-[140px] xl:min-w-[160px] text-left align-top text-sm p-0 relative [&:has([aria-selected].day-range-end)]:rounded-r-md [&:has([aria-selected].day-outside)]:bg-accent/50 [&:has([aria-selected])]:bg-accent first:[&:has([aria-selected])]:rounded-l-md last:[&:has([aria-selected])]:rounded-r-md focus-within:relative focus-within:z-20",
                  }}
                />
              </div>

            </div>
          </CardContent>
        </Card>

        

        <div className="grid gap-6 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle className="text-slate-900">Clients Overview</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Client</TableHead>
                      <TableHead className="hidden md:table-cell">Last Activity</TableHead>
                      <TableHead>Docs</TableHead>
                      <TableHead>Due Soon</TableHead>
                      <TableHead>Overdue</TableHead>
                      <TableHead className="hidden md:table-cell">Messages</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {clientRows.map((row) => (
                      <TableRow key={row.client.id}>
                        <TableCell>
                          <div className="font-medium">
                            <Link to={`/clients/${row.client.id}`} className="text-blue-600 hover:underline">{row.client.name}</Link>
                          </div>
                          <div className="text-xs text-slate-500">{row.client.email}</div>
                        </TableCell>
                        <TableCell className="hidden md:table-cell text-sm text-slate-700">{row.client.lastActivity.toLocaleDateString()}</TableCell>
                        <TableCell>{row.documentsCount}</TableCell>
                        <TableCell>
                          {row.dueSoon > 0 ? (
                            <Badge className="bg-amber-100 text-amber-800 border-amber-200">{row.dueSoon}</Badge>
                          ) : (
                            <span className="text-slate-500">0</span>
                          )}
                        </TableCell>
                        <TableCell>
                          {row.overdue > 0 ? (
                            <Badge className="bg-red-100 text-red-800 border-red-200">{row.overdue}</Badge>
                          ) : (
                            <span className="text-slate-500">0</span>
                          )}
                        </TableCell>
                        <TableCell className="hidden md:table-cell">{row.unreadMessages}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-slate-900">Upcoming Deadlines</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {upcoming.length === 0 && (
                  <div className="text-sm text-slate-500">No upcoming deadlines.</div>
                )}
                {upcoming.map((item) => (
                    <div key={`${item.doc.id}-${item.due!.toISOString()}`} className="p-3 border rounded-lg">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="font-medium text-slate-900 text-sm">
                          <Link to={`/documents/${item.doc.id}`} className="text-blue-600 hover:underline">{item.doc.name}</Link>
                        </div>
                        <div className="text-xs text-slate-500">
                          {item.client ? (
                            <Link to={`/clients/${item.client.id}`} className="text-blue-600 hover:underline">{item.client.name}</Link>
                          ) : 'Unassigned'}
                          {` • ${item.doc.folder}`}
                        </div>
                      </div>
                      <Badge className="bg-blue-100 text-blue-800 border-blue-200">Due {item.due!.toLocaleDateString()}</Badge>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
};

export default FinancialOverview;



