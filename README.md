# 🎬 Paral·lel Film Festival (PFF)

![PFF Banner](public/og-image.png)

**Paral·lel Film Festival** is a high-end, cinematic film proposal and voting platform. Designed with a **Noir & Indigo** aesthetic, it provides a premium space for film enthusiasts to curate their own festivals through real-time collaboration and discovery.

---

## 💎 Premium Design Philosophy
The application features a cutting-edge **Glassmorphism** interface with:
- **Noir & Indigo Palette:** Deep obsidian backgrounds with vibrant indigo accents.
- **Cinematic Textures:** Refined typography using *Outfit* (Headings), *Syne* (Logo), and *Inter* (Body/UI).
- **Dynamic Micro-interactions:** Smooth transitions, hover-glow effects, and glass-blur overlays.

---

## ⚡ Core Features

### 🔍 Discovery & Proposals
- **TMDB Smart Search:** Real-time search powered by The Movie Database API, enriched with director credits, genres, and synopses.
- **Curated Results:** Intelligent popularity filtering to prioritize well-known titles.
- **Proposal System:** Logged-in users can propose films to the shared dashboard.

### 🗳️ Living Lineup
- **Dynamic Voting:** Real-time community voting with heart-based micro-animations.
- **Vote Persistence:** Powered by Supabase to ensure every vote counts across sessions.

### 🛡️ Authentication & Profiles
- **Secure Access:** Integrated with Supabase Auth (Email & Social).
- **Personal Dashboard:** Track your proposals and voting activity in a personalized profile view.
- **Role-Based Controls:** Automated admin roles for festival management (e.g., marking movies as seen).

### 🎬 Seen History
- **Archival Feed:** Move films from the live lineup to the history section once they've been watched.
- **Community Rating:** (Coming Soon) Rate films in the history section once viewed.

---

## 🛠️ Technology Stack

| Architecture | Component | Technology |
| :--- | :--- | :--- |
| **Frontend** | Build Tool | [Vite](https://vitejs.dev/) |
| | Framework | Vanilla JavaScript (SPA Architecture) |
| | Styling | Vanilla CSS (Glassmorphism / Noir System) |
| | Icons | [Lucide](https://lucide.dev/) |
| **Backend** | Database | [Supabase](https://supabase.com/) (PostgreSQL) |
| | Auth | Supabase Auth |
| | API | [TMDB API](https://www.themoviedb.org/documentation/api) |

---

## 🚀 Getting Started

### Prerequisites
- Node.js (v18+)
- A Supabase Project
- A TMDB API Key

### Installation

1. **Clone the repository:**
   ```bash
   git clone https://github.com/yourusername/pff.git
   cd pff
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Configure Environment Variables:**
   Create a `.env` file in the root:
   ```env
   VITE_SUPABASE_URL=your_supabase_url
   VITE_SUPABASE_ANON_KEY=your_supabase_key
   VITE_TMDB_API_KEY=your_tmdb_key
   ```

4. **Launch Development Server:**
   ```bash
   npm run dev
   ```

---

## 📜 Database Schema
To enable the full feature set, ensure your Supabase instance includes the following tables:
- `movies`: Stores proposals, genres, and metadata.
- `votes`: Tracks user interaction.
- `profiles`: Manages user roles and festival permissions.

---

*“Celebrating cinema, one frame at a time.”*
**© 2024 Paral·lel Film Festival**
