# 🚀 TeamSync

Welcome to **TeamSync**, a powerful, production-grade, multi-tenant team and project management SaaS application built with **Node.js**, **Express**, **MongoDB**, **React**, and **TypeScript**. 

Designed for modern B2B workforce collaboration, TeamSync features Google OAuth 2.0 & Email/Password authentication, multi-workspace isolation, project and task tracking, granular role-based permissions (RBAC), and analytics dashboards.

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
- [Directory & Project Structure](#-directory--project-structure)
- [Database Schema & Models](#-database-schema--models)
- [Environment Variables Configuration](#-environment-variables-configuration)
- [Getting Started & Local Run Guide](#-getting-started--local-run-guide)
- [API Endpoints Reference](#-api-endpoints-reference)
- [Deployment Guide](#-deployment-guide)

---

## 💡 Project Overview

**TeamSync** is built from the ground up to solve modern team productivity challenges in a multi-tenant environment. Organizations can manage multiple workspace instances, invite members with scoped roles (`OWNER`, `ADMIN`, `MEMBER`), assign tasks with priority and status states, and track real-time project health.

---

## ✨ Key Features

- 🔐 **Multi-Provider Authentication**: Google OAuth 2.0 & Email/Password login via Passport.js.
- 🏢 **Multi-Tenancy Workspaces**: Create, switch, and manage isolated workspaces with unique invite codes.
- 👥 **Role-Based Access Control (RBAC)**: Fine-grained permissions (Workspace Owner, Admin, Member).
- 📁 **Projects Management**: Create and track workspace projects with progress metrics and emojis.
- 📋 **Task Management**: Full task lifecycle (`BACKLOG`, `TODO`, `IN_PROGRESS`, `IN_REVIEW`, `DONE`), priorities (`LOW`, `MEDIUM`, `HIGH`), and member assignees.
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
- **`Task`**: Task title, status, priority, project, workspace, assigned member, due date.

---

## ⚙️ Environment Variables Configuration

### Backend Environment ([`backend/.env`](file:///C:/Merged%20Drive/coding%20files/web%20development/Major%20Project/Team%20management%20portal/backend/.env))
```env
PORT=8000
NODE_ENV=development

MONGO_URI="mongodb+srv://<username>:<password>@cluster.mongodb.net/teamSync"

SESSION_SECRET="your_session_secret_key"
SESSION_EXPIRES_IN="24h"

GOOGLE_CLIENT_ID="your_google_client_id"
GOOGLE_CLIENT_SECRET="your_google_client_secret"
GOOGLE_CALLBACK_URL="http://localhost:8000/api/auth/google/callback"

FRONTEND_ORIGIN="http://localhost:5173"
FRONTEND_GOOGLE_CALLBACK_URL="http://localhost:5173/google/oauth/callback"
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

## 🔌 API Endpoints Reference

| Category | Endpoint | Method | Description |
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
| **Project** | `/api/project/workspace/:workspaceId/create` | `POST` | Create a workspace project |
| **Project** | `/api/project/workspace/:workspaceId/all` | `GET` | List workspace projects |
| **Project** | `/api/project/:id` | `GET` | Get project details & tasks summary |
| **Task** | `/api/task/workspace/:workspaceId/project/:projectId/create` | `POST` | Create a new task |
| **Task** | `/api/task/workspace/:workspaceId/all` | `GET` | Get & filter workspace tasks |

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
