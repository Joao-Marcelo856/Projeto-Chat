process.on("uncaughtException", (err) => {
  console.error("ERRO FATAL:", err);
});

const multer = require("multer");
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const sqlite3 = require("sqlite3").verbose();
const bcrypt = require("bcryptjs");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const fs = require("fs");

const uploadPath = path.join(__dirname, "uploads");

if (!fs.existsSync(uploadPath)) {
  fs.mkdirSync(uploadPath, { recursive: true });
}

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadPath);
  },
  filename: function (req, file, cb) {
    const uniqueName = Date.now() + "-" + file.originalname;
    cb(null, uniqueName);
  },
});

const upload = multer({ storage });

app.post("/upload", upload.single("image"), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "Nenhum arquivo enviado" });
  }

  const imageUrl = `/uploads/${req.file.filename}`;
  res.json({ url: imageUrl });
});

// Banco de Dados
const db = new sqlite3.Database(path.join(__dirname, "chat.db"));

db.serialize(() => {
  // Tabela de Usuários (ID, Nome Único, Senha Criptografada)
  db.run(
    "CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE, password TEXT)",
  );

  // Tabela de Mensagens (ID, Sala, Usuário, Texto, URL Imagem, ID da Resposta, Data)
  db.run(`CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT, 
        room TEXT, 
        user TEXT, 
        text TEXT, 
        image_url TEXT, 
        reply_to_id INTEGER,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
});

db.run("ALTER TABLE messages ADD COLUMN avatar TEXT", (err) => {
  if (err) {
    console.log("Coluna avatar já existe 👍");
  } else {
    console.log("Coluna avatar criada 🚀");
  }
});

app.use("/uploads", express.static("uploads"));

app.use(express.static(__dirname));

io.on("connection", (socket) => {
  socket.on("typing", (data) => {
    socket.to(data.room).emit("typing", data.user);
    console.log("Conectado:", socket.id);
  });

  // LOGICA DE REGISTRO
  socket.on("register", async (data) => {
    try {
      const hash = await bcrypt.hash(data.password, 10);
      db.run(
        "INSERT INTO users (username, password) VALUES (?, ?)",
        [data.username, hash],
        function (err) {
          if (err) return socket.emit("auth_error", "Este nome já existe!");
          socket.emit("auth_success", data.username);
        },
      );
    } catch (e) {
      socket.emit("auth_error", "Erro no servidor");
    }
  });

  // LOGICA DE LOGIN
  socket.on("login", (data) => {
    db.get(
      "SELECT * FROM users WHERE username = ?",
      [data.username],
      async (err, row) => {
        if (!row) return socket.emit("auth_error", "Usuário não encontrado!");
        const match = await bcrypt.compare(data.password, row.password);
        if (match) socket.emit("auth_success", data.username);
        else socket.emit("auth_error", "Senha incorreta!");
      },
    );
  });

  // TROCA DE SALA E HISTÓRICO
  socket.on("switch_room", (newRoom) => {
    socket.rooms.forEach((room) => socket.leave(room));
    socket.join(newRoom);
    db.all(
      "SELECT * FROM messages WHERE room = ? ORDER BY timestamp ASC",
      [newRoom],
      (err, rows) => {
        socket.emit("load_history", rows);
      },
    );
  });

  // ENVIO DE MENSAGEM
  socket.on("chat message", (data) => {
    db.run(
      "INSERT INTO messages (room, user, text, image_url, reply_to_id, avatar) VALUES (?, ?, ?, ?, ?, ?)",
      [
        data.room,
        data.user,
        data.text,
        data.image_url,
        data.replyToId,
        data.avatar,
      ],
      function (err) {
        io.to(data.room).emit("chat message", { id: this.lastID, ...data });
      },
    );
  });

  // APAGAR MENSAGEM
  socket.on("delete message", (data) => {
    const { msgId, user } = data;

    db.get("SELECT * FROM messages WHERE id = ?", [msgId], (err, row) => {
      if (row && row.user === user) {
        db.run("DELETE FROM messages WHERE id = ?", [msgId], () => {
          io.emit("message deleted", msgId);
        });
      }
    });
  });

  socket.on("edit message", (data) => {
    const { msgId, newText, user } = data;

    db.get("SELECT * FROM messages WHERE id = ?", [msgId], (err, row) => {
      if (row && row.user === user) {
        db.run(
          "UPDATE messages SET text = ? WHERE id = ?",
          [newText, msgId],
          () => {
            io.emit("message edited", {
              id: msgId,
              newText,
            });
          },
        );
      }
    });
  });

  const PORT = process.env.PORT || 3000;

  server.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
  });
});
