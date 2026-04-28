const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const sqlite3 = require("sqlite3").verbose();
const bcrypt = require("bcrypt");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Banco de Dados
const db = new sqlite3.Database("./chat.db");

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

app.use(express.static(__dirname));

io.on("connection", (socket) => {
  console.log("Conectado:", socket.id);

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
      "INSERT INTO messages (room, user, text, image_url, reply_to_id) VALUES (?, ?, ?, ?, ?)",
      [data.room, data.user, data.text, data.image_url, data.replyToId],
      function (err) {
        io.to(data.room).emit("chat message", { id: this.lastID, ...data });
      },
    );
  });

  // APAGAR MENSAGEM
  socket.on("delete message", (msgId) => {
    db.run("DELETE FROM messages WHERE id = ?", [msgId], (err) => {
      if (!err) {
        // Emite para TODOS os clientes que a mensagem foi apagada
        io.emit("message deleted", msgId);
      } else {
        console.error("Erro ao deletar:", err);
      }
    });
  });

  // O Render vai preencher o process.env.PORT automaticamente
  const PORT = process.env.PORT || 3000;

  server.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
  });
});
