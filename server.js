const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const sqlite3 = require("sqlite3").verbose();
const bcrypt = require("bcryptjs");
const multer = require("multer");
const fs = require("fs");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Pasta para uploads
const uploadPath = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadPath)) fs.mkdirSync(uploadPath, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadPath),
  filename: (req, file, cb) => cb(null, Date.now() + "-" + file.originalname),
});
const upload = multer({ storage });

const db = new sqlite3.Database("./chat.db");

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT, 
        username TEXT UNIQUE, 
        password TEXT,
        avatar TEXT DEFAULT '/uploads/default-avatar.png'
    )`);

  db.run(`CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT, 
        room TEXT, 
        user TEXT, 
        text TEXT, 
        image_url TEXT, 
        avatar TEXT,
        reply_to_id INTEGER,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
});

app.use(express.static(__dirname));
app.use("/uploads", express.static("uploads"));

app.post("/upload", upload.single("image"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Erro no upload" });
  res.json({ url: `/uploads/${req.file.filename}` });
});

io.on("connection", (socket) => {
  // Registro
  socket.on("register", async (data) => {
    try {
      const hash = await bcrypt.hash(data.password, 10);
      db.run(
        "INSERT INTO users (username, password) VALUES (?, ?)",
        [data.username, hash],
        function (err) {
          if (err) return socket.emit("auth_error", "Este usuário já existe.");
          socket.emit("auth_success", {
            username: data.username,
            avatar: "/uploads/default-avatar.png",
          });
          io.emit("refresh_users");
        },
      );
    } catch (e) {
      socket.emit("auth_error", "Erro no servidor.");
    }
  });

  // Login
  socket.on("login", (data) => {
    db.get(
      "SELECT * FROM users WHERE username = ?",
      [data.username],
      async (err, row) => {
        if (!row) return socket.emit("auth_error", "Usuário não encontrado.");
        const match = await bcrypt.compare(data.password, row.password);
        if (match)
          socket.emit("auth_success", {
            username: row.username,
            avatar: row.avatar,
          });
        else socket.emit("auth_error", "Senha incorreta.");
      },
    );
  });

  socket.on("get_users", () => {
    db.all("SELECT username, avatar FROM users", [], (err, rows) => {
      if (!err) socket.emit("user_list", rows);
    });
  });

  socket.on("update_profile", (data) => {
    db.run(
      "UPDATE users SET username = ?, avatar = ? WHERE username = ?",
      [data.newName, data.newAvatar, data.oldName],
      (err) => {
        if (!err) {
          db.run("UPDATE messages SET user = ?, avatar = ? WHERE user = ?", [
            data.newName,
            data.newAvatar,
            data.oldName,
          ]);
          socket.emit("profile_updated", {
            username: data.newName,
            avatar: data.newAvatar,
          });
          io.emit("refresh_users");
        }
      },
    );
  });

  socket.on("switch_room", (newRoom) => {
    socket.rooms.forEach((r) => socket.leave(r));
    socket.join(newRoom);
    db.all(
      "SELECT * FROM messages WHERE room = ? ORDER BY timestamp ASC",
      [newRoom],
      (err, rows) => {
        socket.emit("load_history", rows);
      },
    );
  });

  socket.on("chat message", (data) => {
    db.run(
      "INSERT INTO messages (room, user, text, image_url, avatar, reply_to_id) VALUES (?, ?, ?, ?, ?, ?)",
      [
        data.room,
        data.user,
        data.text,
        data.image_url || null,
        data.avatar || "/uploads/default-avatar.png",
        data.replyToId || null,
      ],
      function (err) {
        if (err) {
          console.error("Erro ao salvar mensagem:", err);
          return;
        }

        io.to(data.room).emit("chat message", {
          id: this.lastID,
          ...data,
        });
      },
    );
  });
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});