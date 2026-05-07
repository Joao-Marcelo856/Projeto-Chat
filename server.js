const onlineUsers = {};
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

const io = new Server(server, {
  cors: {
    origin: "*",
  },
});

// =========================
// UPLOADS
// =========================

const uploadPath = path.join(__dirname, "uploads");

if (!fs.existsSync(uploadPath)) {
  fs.mkdirSync(uploadPath, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadPath);
  },

  filename: (req, file, cb) => {
    cb(null, Date.now() + "-" + file.originalname);
  },
});

const upload = multer({ storage });

// =========================
// DATABASE
// =========================

const db = new sqlite3.Database("./chat.db");

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE,
      password TEXT,
      avatar TEXT DEFAULT '/uploads/default-avatar.png',
      isAdmin INTEGER DEFAULT 0,
      isMuted INTEGER DEFAULT 0,
      isBanned INTEGER DEFAULT 0
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      room TEXT,
      user TEXT,
      text TEXT,
      image_url TEXT,
      avatar TEXT,
      reply_to_id INTEGER,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
});

// =========================
// STATIC
// =========================

app.use(express.static(__dirname));

app.use("/uploads", express.static(uploadPath));

// =========================
// UPLOAD ROUTE
// =========================

app.post("/upload", upload.single("image"), (req, res) => {
  if (!req.file) {
    return res.status(400).json({
      error: "Erro no upload",
    });
  }

  res.json({
    url: `/uploads/${req.file.filename}`,
  });
});

// =========================
// SOCKET
// =========================

io.on("connection", (socket) => {
  console.log("Novo usuário conectado:", socket.id);

  // REGISTER

  socket.on("register", async (data) => {
    try {
      const hash = await bcrypt.hash(data.password, 10);

      db.run(
        `
        INSERT INTO users (username, password)
        VALUES (?, ?)
        `,
        [data.username, hash],

        function (err) {
          if (err) {
            console.error(err);

            return socket.emit("auth_error", "Este usuário já existe.");
          }

          socket.emit("auth_success", {
            username: data.username,
            avatar: "/uploads/default-avatar.png",
            isAdmin: 0,
            isMuted: 0,
          });

          onlineUsers[data.username] = socket.id;

          io.emit("refresh_users");
        },
      );
    } catch (e) {
      console.error(e);

      socket.emit("auth_error", "Erro no servidor.");
    }
  });

  // LOGIN

  socket.on("login", (data) => {
    db.get(
      `
      SELECT *
      FROM users
      WHERE username = ?
      `,
      [data.username],

      async (err, row) => {
        if (err) {
          console.error(err);

          return socket.emit("auth_error", "Erro no banco.");
        }

        if (!row) {
          return socket.emit("auth_error", "Usuário não encontrado.");
        }

        if (row.isBanned === 1) {
          return socket.emit("auth_error", "Você foi banido.");
        }

        const match = await bcrypt.compare(data.password, row.password);

        if (!match) {
          return socket.emit("auth_error", "Senha incorreta.");
        }

        socket.emit("auth_success", {
          username: row.username,
          avatar: row.avatar,
          isAdmin: row.isAdmin,
          isMuted: row.isMuted,
        });

        onlineUsers[row.username] = socket.id;

        io.emit("refresh_users");
      },
    );
  });

  // GET USERS

  socket.on("get_users", () => {
    db.all(
      `
      SELECT username, avatar
      FROM users
      `,
      [],

      (err, rows) => {
        if (err) {
          console.error(err);
          return;
        }

        socket.emit("user_list", rows);
      },
    );
  });

  // UPDATE PROFILE

  socket.on("update_profile", (data) => {
    db.run(
      `
      UPDATE users
      SET username = ?, avatar = ?
      WHERE username = ?
      `,
      [data.newName?.trim() || data.oldName, data.newAvatar, data.oldName],

      (err) => {
        if (err) {
          console.error(err);
          return;
        }

        db.run(
          `
          UPDATE messages
          SET user = ?, avatar = ?
          WHERE user = ?
          `,
          [data.newName?.trim() || data.oldName, data.newAvatar, data.oldName],
        );

        socket.emit("profile_updated", {
          username: data.newName,
          avatar: data.newAvatar,
        });

        io.emit("refresh_users");
      },
    );
  });

  // SWITCH ROOM

  socket.on("switch_room", async (newRoom) => {
    // sair das salas antigas
    const rooms = [...socket.rooms];

    for (const room of rooms) {
      if (room !== socket.id) {
        await socket.leave(room);
      }
    }

    // entrar na nova sala
    await socket.join(newRoom);

    console.log("Usuário entrou na sala:", newRoom);

    db.all(
      `
    SELECT *
    FROM messages
    WHERE room = ?
    ORDER BY timestamp ASC
    `,
      [newRoom],

      (err, rows) => {
        if (err) {
          console.error(err);
          return;
        }

        socket.emit("load_history", rows);
      },
    );
  });

  // CHAT MESSAGE - Versão com Debug e Correção

  socket.on("chat message", (data) => {
    console.log("--- Nova Mensagem Recebida no Servidor ---");
    console.log("Usuário:", data.user, "| Sala:", data.room);

    if (!data.text && !data.image_url) return;

    // Procure por esta linha no seu socket.on("chat message")
    db.get(
      "SELECT isMuted, isBanned FROM users WHERE LOWER(username) = LOWER(?)", // Usamos LOWER para ignorar maiúsculas
      [data.user],
      (err, row) => {
        if (err) {
          console.error("Erro no banco:", err);
          return;
        }

        if (!row) {
          // Se cair aqui, o usuário 'data.user' não existe na tabela 'users'
          console.log(`[ERRO] O usuário "${data.user}" tentou postar mas não existe no banco.`);
          socket.emit("auth_error", "Sua sessão expirou. Por favor, faça login novamente.");
          return;
        }

        if (row.isBanned === 1) {
          socket.emit("auth_error", "Você foi banido.");
          return socket.disconnect();
        }

        if (row.isMuted === 1) {
          return socket.emit("auth_error", "Você está silenciado.");
        }

        db.run(
          `INSERT INTO messages (room, user, text, image_url, avatar, reply_to_id)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [
            data.room,
            data.user,
            data.text || "",
            data.image_url || null,
            data.avatar || "/uploads/default-avatar.png",
            data.replyToId || null,
          ],
          function (err) {
            if (err) {
              console.error("[ERRO DB INSERT]:", err);
              return;
            }

            const messageData = {
              id: this.lastID,
              room: data.room,
              user: data.user,
              text: data.text || "",
              image_url: data.image_url || null,
              avatar: data.avatar || "/uploads/default-avatar.png",
              reply_to_id: data.replyToId || null,
              timestamp: new Date()
            };

            // Envia para TODOS na sala (incluindo o remetente)
            io.to(data.room).emit("chat message", messageData);
            console.log("[SUCESSO]: Mensagem enviada para a sala", data.room);
          }
        );
      }
    );
  });

  // DELETE MESSAGE

  socket.on("delete_message", (data) => {
    db.get(
      `
      SELECT isAdmin
      FROM users
      WHERE username = ?
      `,
      [data.admin],

      (err, row) => {
        if (err || !row) return;

        if (row.isAdmin !== 1) return;

        db.run(
          `
          DELETE FROM messages
          WHERE id = ?
          `,
          [data.messageId],

          () => {
            io.emit("message_deleted", data.messageId);
          },
        );
      },
    );
  });

  // MUTE USER

  socket.on("mute_user", (data) => {
    db.get(
      "SELECT isAdmin FROM users WHERE username = ?",
      [data.admin],

      (err, row) => {
        if (err || !row) return;

        if (row.isAdmin !== 1) return;

        db.run(
          "UPDATE users SET isMuted = 1 WHERE username = ?",
          [data.target],

          () => {
            const targetSocketId = onlineUsers[data.target];

            if (targetSocketId) {
              io.to(targetSocketId).emit("muted");
            }

            io.emit("refresh_users");
          },
        );
      },
    );
  });

  // UNMUTE USER

  socket.on("unmute_user", (data) => {
    db.get(
      "SELECT isAdmin FROM users WHERE username = ?",
      [data.admin],

      (err, row) => {
        if (err || !row) return;

        if (row.isAdmin !== 1) return;

        db.run(
          "UPDATE users SET isMuted = 0 WHERE username = ?",
          [data.target],

          () => {
            const targetSocketId = onlineUsers[data.target];

            if (targetSocketId) {
              io.to(targetSocketId).emit("unmuted");
            }

            io.emit("refresh_users");
          },
        );
      },
    );
  });

  // BAN USER

  socket.on("ban_user", (data) => {
    db.get(
      "SELECT isAdmin FROM users WHERE username = ?",
      [data.admin],

      (err, row) => {
        if (err || !row) return;

        if (row.isAdmin !== 1) return;

        db.run(
          "UPDATE users SET isBanned = 1 WHERE username = ?",
          [data.target],

          () => {
            const targetSocketId = onlineUsers[data.target];

            if (targetSocketId) {
              io.to(targetSocketId).emit("user_banned");
            }

            io.emit("refresh_users");
          },
        );
      },
    );
  });

  // DISCONNECT

  socket.on("disconnect", () => {
    console.log("Usuário desconectado:", socket.id);
    for (const username in onlineUsers) {
      if (onlineUsers[username] === socket.id) {
        delete onlineUsers[username];
      }
    }
  });
});

// =========================
// SERVER
// =========================

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
