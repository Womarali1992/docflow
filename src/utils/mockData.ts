// Re-export generated mock data for backward compatibility
import { 
  generateMockClients, 
  generateMockDocuments, 
  generateMockMessages, 
  generateMockActivities 
} from './mockDataGenerator';

export const mockClients = generateMockClients();
export const mockMessages = generateMockMessages();
export const mockDocuments = generateMockDocuments();
export const mockActivities = generateMockActivities();




