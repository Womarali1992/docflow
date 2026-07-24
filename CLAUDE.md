# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

- **Start development server**: `npm run dev` (runs on http://localhost:8080)
- **Build for production**: `npm run build` 
- **Build for development**: `npm run build:dev`
- **Lint code**: `npm run lint`
- **Preview production build**: `npm run preview`

## Project Architecture

This is a **Wealth Link Portal** built as a modern React application for financial advisors and their clients to manage documents and communications.

### Technology Stack
- **Framework**: React 18 with TypeScript
- **Build Tool**: Vite
- **UI Library**: shadcn/ui components built on Radix UI primitives
- **Styling**: Tailwind CSS with CSS variables for theming
- **Routing**: React Router DOM v6
- **State Management**: React Context API with custom DocumentsContext
- **Data Fetching**: TanStack Query (React Query)
- **Forms**: React Hook Form with Zod validation
- **Charts**: Recharts library

### Application Structure

#### Core Architecture
- **Multi-role application**: Supports both `advisor` and `client` user roles
- **Document-centric workflow**: Manages document requests, uploads, and updates
- **Context-based state**: Global document state managed via `DocumentsContext`
- **Route-based navigation**: Separate views for different user workflows

#### Key Routes
- `/` - Dashboard/Index page
- `/clients/:clientId` - Client detail view
- `/documents/:documentId` - Document detail view
- `/overview` - Financial overview page
- `/settings` - Application settings

#### Core Components
- **AdvisorDashboard**: Main advisor interface
- **ClientDocumentCard**: Document display for client view
- **DocumentLibrary**: File management interface
- **DocumentUpload**: File upload handling
- **MessagesSection**: Communication interface
- **RequestedDocumentsSection**: Document request management

#### State Management
- **DocumentsContext** (`src/context/DocumentsContext.tsx`): Centralized document state with operations for:
  - Document requests and updates
  - Frequency management (daily, monthly, quarterly, yearly, one-time)
  - Time period selection for recurring documents
  - Document presets for bulk operations
  - Persistent storage via localStorage

#### Type System
- **Comprehensive TypeScript types** in `src/types/dashboard.ts`
- **User roles**: `advisor` | `client`
- **Document statuses**: `pending` | `reviewed` | `needs_update` | `fulfilled`
- **Request frequencies**: `daily` | `monthly` | `quarterly` | `yearly` | `one-time`

### Configuration

#### Path Aliases
- `@/` maps to `src/`
- `@/components` for React components
- `@/lib` for utilities
- `@/hooks` for custom hooks
- `@/ui` for shadcn/ui components

#### Styling System
- Uses CSS variables for theming (see `src/index.css`)
- Custom Tailwind configuration with extended colors
- Dark mode support via `class` strategy
- Sidebar color system for navigation components

### Important Notes

#### Document Management
- Documents support versioning and update requests
- Recurring document requests with configurable frequencies
- Time period selection for quarterly/yearly documents
- Document presets allow bulk document requests to clients

#### File Structure Patterns
- UI components in `src/components/ui/` (shadcn/ui)
- Business components in `src/components/`
- Utility functions organized by domain (`dateUtils`, `documentUtils`, etc.)
- Constants defined in `src/constants/app.ts`

#### Development Patterns
- Prefer Context API over prop drilling for shared state
- Use Zod for form validation schemas
- Follow shadcn/ui component patterns for consistency
- Leverage TypeScript strict mode for type safety