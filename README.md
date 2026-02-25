# Dropken 

Drop files. Instantly.

Dropken is a blazing fast, web-based file sharing and real-time chat application. It allows users to quickly transfer files seamlessly across devices with an intuitive interface, live progress tracking, and group chat functionality.

## Features 

- **Instant File Sharing**: Upload and drop multiple files effortlessly.
- **Real-Time Chat**: Live, lightweight chat room for the active session (with message pagination & history).
- **Beautiful UI**: Modern, responsive interface with smooth animations and WhatsApp-like upload progress indicators.
- **Member Management**: See who is online, with options to manage the current active users.
- **Docker Support**: Easy deployment via Docker Compose.

## Installation 

### Using Docker (Recommended)

Dropken is dockerized for easy deployment. Just ensure you have Docker and Docker Compose installed.

1. Clone the repository:
   ```bash
   git clone https://github.com/moduken/dropken.git
   cd dropken
   ```

2. Run with Docker Compose:
   ```bash
   docker-compose up -d
   ```

3. Open your browser and navigate to `http://localhost:3000`.

### Running Locally (Node.js)

If you prefer to run it locally without Docker:

1. Clone the repo and navigate to the directory:
   ```bash
   git clone https://github.com/moduken/dropken.git
   cd dropken
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Start the application:
   ```bash
   npm run start
   ```
   *(For development with auto-restart, you can run `npm run dev`)*

4. Open your browser and navigate to `http://localhost:3000`.

## Tech Stack 🛠

- **Backend**: Node.js, Express, Socket.io
- **Frontend**: HTML5, Vanilla JS, CSS
- **Database**: SQLite (better-sqlite3)

## Support & Contact 🤝

- Threads: [@moduken](https://threads.net/@moduken)

## License 📄

This project is licensed under the [MIT License](LICENSE).

---
&copy; 2026 Moduken
