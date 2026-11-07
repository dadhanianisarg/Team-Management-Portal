# 🚀 Coordina

Welcome to **Coordina**, a powerful, production-grade, multi-tenant team and project management SaaS application built with **Node.js**, **Express**, **MongoDB**, **React**, and **TypeScript**. 

Designed for modern B2B workforce collaboration, Coordina features Google OAuth 2.0 & Email/Password authentication, multi-workspace isolation, project and task tracking, granular role-based permissions (RBAC), and analytics dashboards.

---

## 📋 Table of Contents

- [Project Overview](#-project-overview)
- [Key Features](#-key-features)
- [Tools & Technologies](#-tools--technologies)
- [System Architecture & Design Principles](#-system-architecture--design-principles)
  - [Multi-Tenancy Model](#1-multi-tenancy-model)
  - [Role-Based Access Control (RBAC)](#2-role-based-access-control-rbac)
  - [Mongoose Transactions & Data Integrity](#3-mongoose-transactions--data-integrity)
  - [Database Seeding System](#4-database-seeding-system)
  - [Lease-Based Pessimistic Locking & Fencing Tokens](#5-lease-based-pessimistic-locking--fencing-tokens)
  - [End-to-End Idempotency System](#6-end-to-end-idempotency-system)
- [Directory & Project Structure](#-directory--project-structure)
- [Database Schema & Models](#-database-schema--models)
- [Environment Variables Configuration](#-environment-variables-configuration)
- [Getting Started & Local Run Guide](#-getting-started--local-run-guide)
- [API Endpoints Reference](#-api-endpoints-reference)
- [Deployment Guide](#-deployment-guide)

---

## 💡 Project Overview

**Coordina** is built from the ground up to solve modern team productivity challenges in a multi-tenant environment. Organizations can manage multiple workspace instances, invite members with scoped roles (`OWNER`, `ADMIN`, `MEMBER`), assign tasks with priority and status states, and track real-time project health.

---

## ✨ Key Features

- 🔐 **Multi-Provider Authentication**: Google OAuth 2.0 & Email/Password login via Passport.js.
- 🏢 **Multi-Tenancy Workspaces**: Create, switch, and manage isolated workspaces with unique invite codes.
- 👥 **Role-Based Access Control (RBAC)**: Fine-grained permissions (Workspace Owner, Admin, Member).
- 📁 **Projects Management**: Create and track workspace projects with progress metrics and emojis.
- 📋 **Task Management**: Full task lifecycle (`BACKLOG`, `TODO`, `IN_PROGRESS`, `IN_REVIEW`, `DONE`), priorities (`LOW`, `MEDIUM`, `HIGH`), and member assignees.
- 🔒 **Lease-Based Pessimistic Locking**: Distributed exclusive claim, renew, and release locking for tasks with monotonic fencing tokens (`lockVersion`), atomic MongoDB query protection, and automatic lease expiration across multiple server instances.
- 🔁 **End-to-End Idempotency**: Production-quality idempotency mechanism across frontend (`sessionStorage` UUID generation & canonical payload comparison) and backend (MongoDB multi-document replica-set transactions, unique compound indexes, SHA-256 canonical hashing, and bounded concurrent polling) for Task and Project creation.
- 🔍 **Advanced Filtering & Search**: URL-synced task filtering (`nuqs`), status, priority, and assignee search.
- 📊 **Analytics Dashboard**: Workspace and project health metrics (total members, active projects, completed tasks).
- 🔄 **Cookie Session Management**: Secure `express-session` cookies across cross-origin clients.
- 🛡️ **Mongoose Transactions**: Atomic operations for mission-critical actions (seeding, workspace creation).
- 🌱 **Database Seeding**: Automated scripts for initializing roles and permissions.

---

## 🛠 Tools & Technologies

### Frontend ([`client/`](file:///C:/Merged%20Drive/coding%20files/web%20development/Major%20Project/Team%20management%20portal/client))
- **Core**: React 18, Vite.js, TypeScript
- **Styling**: Tailwind CSS, Shadcn UI / Radix UI primitives, Lucide Icons
- **State & Data Fetching**: Zustand (Global state), TanStack Query v5 (React Query)
- **Forms & Validation**: React Hook Form + Zod
- **URL State Management**: `nuqs`
- **HTTP Client**: Axios with credential support

### Backend ([`backend/`](file:///C:/Merged%20Drive/coding%20files/web%20development/Major%20Project/Team%20management%20portal/backend))
- **Runtime**: Node.js + Express.js (TypeScript)
- **Database & ORM**: MongoDB + Mongoose
- **Authentication**: Passport.js (`passport-local`, `passport-google-oauth20`) + `express-session`
- **Validation**: Zod schema validation
- **Development Tooling**: `ts-node-dev`, `typescript`

---

## 🏗 System Architecture & Design Principles

```
                                    +-----------------------+
                                    |     React 18 + Vite   |
                                    |     Tailwind + Query  |
                                    +-----------+-----------+
                                                |
                                      HTTP / REST (Credentials)
                                                |
                                                v
                                    +-----------+-----------+
                                    |     Express.js API    |
                                    |  (TypeScript Router)  |
                                    +-----------+-----------+
                                                |
                 +------------------------------+------------------------------+
                 |                              |                              |
                 v                              v                              v
      +----------+----------+        +----------+----------+        +----------+----------+
      | Auth & Session Guard |        | Zod Schema Validation    |        | RBAC Middleware     |
      | (Passport + Session)|        | (Request Payload Guard)  |        | (Roles & Permissions)|
      +----------+----------+        +----------+----------+        +----------+----------+
                 |                              |                              |
                 +------------------------------+------------------------------+
                                                |
                                                v
                                    +-----------+-----------+
                                    |    Business Services  |
                                    | (Mongoose Transactions)|
                                    +-----------+-----------+
                                                |
                                                v
                                    +-----------+-----------+
                                    |   MongoDB Database    |
                                    | (Mongoose ORM Schemas)|
                                    +-----------------------+
```

### 1. Multi-Tenancy Model
Each user can belong to multiple workspaces, but all workspace data (projects, tasks, members, roles) is strictly scoped to `workspaceId`. Active workspace state is managed globally on both backend sessions and frontend state.

### 2. Role-Based Access Control (RBAC)
Permissions are declared dynamically via a permission utility mapping ([`role-permission.ts`](file:///C:/Merged%20Drive/coding%20files/web%20development/Major%20Project/Team%20management%20portal/backend/src/utils/role-permission.ts)). Users in a workspace hold a `Role` with defined capabilities:
- **`OWNER`**: Full workspace control, delete workspace, manage all members and roles.
- **`ADMIN`**: Create/edit projects, manage tasks, invite members.
- **`MEMBER`**: Create/edit assigned tasks, view projects and team members.

### 3. Mongoose Transactions & Data Integrity
Critical write operations (such as role seeding and workspace creation) utilize Mongoose session transactions (`startTransaction()`, `commitTransaction()`) to guarantee ACID compliance and zero orphan documents.

### 4. Database Seeding System
The system includes a dedicated seeder script ([`role.seeder.ts`](file:///C:/Merged%20Drive/coding%20files/web%20development/Major%20Project/Team%20management%20portal/backend/src/seeders/role.seeder.ts)) to populate all default roles (`OWNER`, `ADMIN`, `MEMBER`) and permissions before starting the application.

### 5. Lease-Based Pessimistic Locking & Fencing Tokens
To prevent write conflicts, race conditions, and accidental overwrites in multi-user distributed deployments:
- **Atomic Acquisition**: Claims are processed using single atomic MongoDB `findOneAndUpdate` queries ensuring only one concurrent request succeeds across any number of backend instances.
- **Lease Expiration**: Locks automatically expire after a configurable duration (`TASK_LOCK_LEASE_DURATION_SEC`, default: 300 seconds). Expired locks can be reclaimed immediately without requiring any cron jobs or TTL index deletion of the underlying document.
- **Fencing Protection (`lockVersion`)**: Each successful lock claim increments a monotonic `lockVersion`. All task updates must provide the matching `lockVersion` and verify unexpired ownership directly in the database write query. Stale client writes are rejected with `HTTP 409 Conflict`.
- **Safe Idempotency**: If the current lock owner repeats a claim request on their actively held task, the system safely returns the active lease without corrupting or bumping the version.
- **Protected Mutations**: Both task updates and deletions enforce lock rules at the database level. Deletions are forbidden while a task is actively locked by another team member.

### 6. End-to-End Idempotency System
To guarantee at-most-once resource creation across distributed network boundaries, double-clicks, retries, and browser refreshes:
- **What & Why**: In distributed networks, client requests may experience network timeouts or disconnections after the database operation succeeds. Without idempotency, automatic retries or repeated user clicks create duplicate tasks or projects. Coordina implements an end-to-end mechanism covering both frontend preservation and backend transactional guarantees.
- **Frontend `sessionStorage` Lifecycle**:
  - Uses `crypto.randomUUID()` to generate an idempotency key.
  - Keys are scoped per logical operation: `coordina:idempotency:create-task:<workspaceId>:<projectId>` and `coordina:idempotency:create-project:<workspaceId>`.
  - The validated creation payload is canonicalized and stored alongside the key.
  - If the user retries with the same payload (or the page refreshes), the existing key is reused.
  - If the user modifies form fields, a new key is generated for the new logical attempt.
  - On confirmed creation success (`HTTP 201`), the matching sessionStorage entry is cleared.
- **Backend `IdempotencyRecord` Model**:
  - Persisted in MongoDB with fields: `userId`, `key` (UUID), `operation` (`CREATE_TASK` | `CREATE_PROJECT`), `workspaceId`, `requestHash` (SHA-256), `status` (`PROCESSING` | `COMPLETED`), `responseStatus`, `responseBody`, and `expiresAt`.
  - Enforces a unique compound index: `{ userId: 1, key: 1, operation: 1, workspaceId: 1 }`.
  - Automatic expiration via a TTL index on `expiresAt` (configurable via `IDEMPOTENCY_RETENTION_HOURS`, default: 24h).
- **Canonical Request Hashing**: Incoming payloads are canonically serialized (recursively sorted keys) and hashed using SHA-256. If a client sends an identical key with a different payload, the request is rejected with `HTTP 409 Conflict` (`IDEMPOTENCY_KEY_REUSED`).
- **Atomic MongoDB Transactions**:
  - Execution runs inside a MongoDB multi-document session transaction (`session.startTransaction()`).
  - Idempotency record creation and target resource creation (Task or Project) commit together atomically.
  - If creation fails or an error is thrown, the transaction aborts cleanly, rolling back any partial changes and leaving no dangling `COMPLETED` record.
- **Concurrent Race Resolution**:
  - When concurrent identical requests arrive simultaneously, the first request acquires the unique compound index lock and transitions to `PROCESSING`.
  - The racing request catches MongoDB error `11000` (duplicate key) and engages bounded retry polling (`waitForWinningTransaction`) until the winning request commits to `COMPLETED`, returning the identical resource response with zero duplicate database documents created.
- **Replica-Set Requirement**: MongoDB multi-document transactions require a replica set (standard on MongoDB Atlas or a local replica set). When transactions are active, full ACID isolation is guaranteed.


---

## 📂 Directory & Project Structure

```
Team management portal/
├── backend/                  # Node.js + Express + TypeScript Backend
│   ├── src/
│   │   ├── @types/           # Express & Passport custom type definitions
│   │   ├── config/           # App, Database, Http, Passport config
│   │   ├── controllers/      # Request handlers (Auth, User, Workspace, Task, etc.)
│   │   ├── enums/            # Error codes, Roles, Account providers
│   │   ├── middlewares/      # Error handler, Auth guard, Async wrapper
│   │   ├── models/           # Mongoose schemas (User, Workspace, Task, Role, Member)
│   │   ├── routes/           # Express router endpoints
│   │   ├── seeders/          # Role and permission seeder script
│   │   ├── services/         # Core business logic layer
│   │   ├── utils/            # Custom AppError classes, Role-Permission mappings
│   │   └── validation/       # Zod validation schemas
│   ├── .env                  # Backend environment variables
│   ├── package.json
│   └── tsconfig.json
│
└── client/                   # React + Vite + TypeScript Frontend
    ├── src/
    │   ├── components/       # UI Primitives (Shadcn/Radix), Auth & Workspace Modals
    │   ├── context/          # React Context providers
    │   ├── hooks/            # Custom Query hooks & API hooks
    │   ├── lib/              # Axios client setup, Base URL resolution
    │   ├── page/             # Main page components (Dashboard, Tasks, Members, Settings)
    │   ├── routes/           # React Router DOM routes
    │   ├── store/            # Zustand global stores
    │   └── types/            # TypeScript interfaces
    ├── .env                  # Client environment variables
    ├── index.html
    ├── package.json
    └── vite.config.ts
```

---

## 🗄 Database Schema & Models

- **`User`**: Profile info, email, hashed password, Google OAuth ID, active workspace reference.
- **`Account`**: OAuth provider links (Google account details).
- **`Workspace`**: Workspace name, description, owner reference, unique invite code.
- **`Member`**: Links a `User` to a `Workspace` with a specific `Role`.
- **`Role`**: Predefined workspace roles (`OWNER`, `ADMIN`, `MEMBER`) and granted permission keys.
- **`Project`**: Project title, emoji, description, associated workspace reference.
- **`Task`**: Task title, status, priority, project, workspace, assigned member, due date, `lockOwner` (User reference), `lockExpiresAt` (lease expiration date), and `lockVersion` (fencing version number).
- **`IdempotencyRecord`**: Idempotency audit & replay log storing `userId`, `key` (UUID), `operation` (`CREATE_TASK` | `CREATE_PROJECT`), `workspaceId`, `requestHash` (SHA-256), `status` (`PROCESSING` | `COMPLETED`), `responseStatus`, `responseBody`, and TTL expiration `expiresAt`.

---

## ⚙️ Environment Variables Configuration

### Backend Environment ([`backend/.env`](file:///C:/Merged%20Drive/coding%20files/web%20development/Major%20Project/Team%20management%20portal/backend/.env))
```env
PORT=8000
NODE_ENV=development

MONGO_URI="mongodb+srv://<username>:<password>@cluster.mongodb.net/Coordina"

SESSION_SECRET="your_session_secret_key"
SESSION_EXPIRES_IN="24h"

GOOGLE_CLIENT_ID="your_google_client_id"
GOOGLE_CLIENT_SECRET="your_google_client_secret"
GOOGLE_CALLBACK_URL="http://localhost:8000/api/auth/google/callback"

FRONTEND_ORIGIN="http://localhost:5173"
FRONTEND_GOOGLE_CALLBACK_URL="http://localhost:5173/google/oauth/callback"

# Lease duration for pessimistic task locks in seconds (Default: 300 = 5 minutes)
TASK_LOCK_LEASE_DURATION_SEC="300"

# Retention duration for idempotency records in hours (Default: 24 hours)
IDEMPOTENCY_RETENTION_HOURS="24"
```

### Client Environment ([`client/.env`](file:///C:/Merged%20Drive/coding%20files/web%20development/Major%20Project/Team%20management%20portal/client/.env))
```env
VITE_API_BASE_URL="http://localhost:8000/api"
```

---

## ⚡ Getting Started & Local Run Guide

### Prerequisites
- **Node.js**: `v18.x` or higher
- **Package Manager**: `npm` / `yarn` / `pnpm`
- **MongoDB**: Local MongoDB instance or MongoDB Atlas cluster connection string

---

### Step 1: Install Dependencies

#### Backend:
```powershell
cd backend
npm install
```

#### Client:
```powershell
cd client
npm install
```

---

### Step 2: Seed Database Roles (Mandatory First Time)

Run the role seeder to initialize default workspace roles and permissions in MongoDB:

```powershell
cd backend
npm run seed
```

---

### Step 3: Start Development Servers

Open two separate terminal windows:

#### Terminal 1 — Backend API:
```powershell
cd backend
npm run dev
```
*API running at `http://localhost:8000`*

#### Terminal 2 — Frontend Application:
```powershell
cd client
npm run dev
```
*Frontend running at `http://localhost:5173`*

---

### Step 4: Run Automated Tests

Coordina includes comprehensive automated integration test suites for both **End-to-End Idempotency** and **Lease-Based Pessimistic Locking**:

```powershell
cd backend
npm test
```
*Executes native Node.js test runner covering 29 test scenarios (`29/29 tests pass`):*
- **End-to-End Idempotency Suite** (15 tests covering 24 scenarios): Task/Project repeated execution with same key, duplicate key prevention, hash collision/mismatch (409 Conflict), missing/malformed UUIDs (400 Bad Request), user/workspace scope isolation, transaction rollbacks on failure, simulated lost HTTP response replay, and genuine concurrent request deduplication.
- **Pessimistic Locking Suite** (14 tests): Atomic acquisition, conflict detection (409 Conflict), safe idempotency on repeat claim, renewal, release, expiration takeover, fencing token (`lockVersion`) validation, workspace isolation, deletion protection, and concurrent race resolution.

---

## 🔌 API Endpoints Reference

| Category | Endpoint | Method | Headers / Description |
| :--- | :--- | :--- | :--- |
| **Auth** | `/api/auth/register` | `POST` | Register a new user |
| **Auth** | `/api/auth/login` | `POST` | User login (Email/Password) |
| **Auth** | `/api/auth/logout` | `POST` | Destroy session & log out |
| **Auth** | `/api/auth/google` | `GET` | Initiate Google OAuth redirect |
| **User** | `/api/user/current` | `GET` | Fetch authenticated user profile |
| **Workspace** | `/api/workspace/create` | `POST` | Create a new workspace |
| **Workspace** | `/api/workspace/all` | `GET` | Fetch all user workspaces |
| **Workspace** | `/api/workspace/:id` | `GET` | Get workspace metadata & analytics |
| **Workspace** | `/api/workspace/join/:inviteCode` | `POST` | Join workspace via invite code |
| **Member** | `/api/member/workspace/:workspaceId` | `GET` | Get all workspace members |
| **Member** | `/api/member/change-role` | `PUT` | Update a member's role |
| **Project** | `/api/project/workspace/:workspaceId/create` | `POST` | Create a project (`Idempotency-Key: <uuid>` supported) |
| **Project** | `/api/project/workspace/:workspaceId/all` | `GET` | List workspace projects |
| **Project** | `/api/project/:id` | `GET` | Get project details & tasks summary |
| **Task** | `/api/task/workspace/:workspaceId/project/:projectId/create` | `POST` | Create a task (`Idempotency-Key: <uuid>` supported) |
| **Task** | `/api/task/workspace/:workspaceId/all` | `GET` | Get & filter workspace tasks (includes lock state) |
| **Task** | `/api/task/:id/project/:projectId/workspace/:workspaceId` | `GET` | Get single task details |
| **Task** | `/api/task/:id/project/:projectId/workspace/:workspaceId/claim` | `PUT` / `POST` | Atomically claim exclusive lock on a task |
| **Task** | `/api/task/:id/project/:projectId/workspace/:workspaceId/renew` | `PUT` / `POST` | Renew active lock lease (owner + lockVersion) |
| **Task** | `/api/task/:id/project/:projectId/workspace/:workspaceId/release` | `PUT` / `POST` | Release lock (owner + lockVersion) |
| **Task** | `/api/task/:id/project/:projectId/workspace/:workspaceId/update` | `PUT` | Update task (requires active lock & matching lockVersion) |
| **Task** | `/api/task/:id/workspace/:workspaceId/delete` | `DELETE` | Delete task (blocked if locked by another member) |

---

## 🚀 Deployment Guide

### Deploying Backend (e.g., Render / Railway)
1. **Build Step**: `npm run build`
2. **Start Command**: `npm run start` (`node dist/index.js`)
3. **Environment Variables**: Configure all variables (`MONGO_URI`, `FRONTEND_ORIGIN`, `SESSION_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`).

### Deploying Frontend (e.g., Vercel)
1. **Environment Variables**: Set `VITE_API_BASE_URL` to your production backend API domain.
2. **Build Command**: `npm run build`
3. **Output Directory**: `dist`
