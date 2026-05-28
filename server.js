require("dotenv").config(); // Mantém esta linha como a primeira do arquivo

const OpenAI = require("openai");

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: "https://openrouter.ai/api/v1",
  defaultHeaders: {
    "HTTP-Referer": process.env.SITE_URL || "http://localhost:3000",
    "X-Title": "Chat Clone Pro",
  },
});

const onlineUsers = {};
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const sqlite3 = require("sqlite3").verbose();
const bcrypt = require("bcryptjs");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const uploadPath = path.join(__dirname, "uploads");

if (!fs.existsSync(uploadPath)) {
  fs.mkdirSync(uploadPath);
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
            pinned INTEGER DEFAULT 0,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

  db.run(`
        CREATE TABLE IF NOT EXISTS friends (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            sender TEXT,
            receiver TEXT
        )
      `);
  db.run(`
    CREATE TABLE IF NOT EXISTS monitored_users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    )
`);

  db.run(`
    CREATE TABLE IF NOT EXISTS behavior_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT,
        text TEXT,
        severity TEXT, -- LEVE, MÉDIO, GRAVE
        reason TEXT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    )
`);
});

app.use(express.static(__dirname));
app.use("/uploads", express.static(uploadPath));

app.post("/upload", upload.single("image"), (req, res) => {
  res.json({
    url: `/uploads/${req.file.filename}`,
  });
});

io.on("connection", (socket) => {
  socket.on("register", async (data) => {
    const hash = await bcrypt.hash(data.password, 10);

    db.run(
      `
            INSERT INTO users (username, password, isAdmin)
            VALUES (?, ?, 1)
        `,
      [data.username, hash],
      function (err) {
        if (err) {
          return socket.emit("auth_error", "Usuário já existe");
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
  });

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
          return socket.emit("auth_error", "Senha incorreta");
        }

        socket.emit("auth_success", {
          username: row.username,
          avatar: row.avatar,
          isAdmin: row.isAdmin,
          isMuted: row.isMuted,
        });

        socket.username = row.username;

        onlineUsers[row.username] = socket.id;
        io.emit("refresh_users");
        sendUsers(socket);
      },
    );
  });

  socket.on("get_users", () => {
    sendUsers(socket);
  });

  function sendUsers(socket) {
    db.all(
      `
            SELECT username, avatar, isMuted
            FROM users
        `,
      [],
      (err, rows) => {
        const users = rows.map((user) => ({
          ...user,
          online: !!onlineUsers[user.username],
        }));
        socket.emit("user_list", users);
      },
    );
  }

  socket.on("switch_room", async (room) => {
    // BLOQUEAR ACESSO AO ADMIN-LOGS
    if (room === "admin-logs") {
      db.get(
        "SELECT isAdmin FROM users WHERE username = ?",
        [socket.username],

        (err, row) => {
          if (err || !row || row.isAdmin !== 1) {
            return;
          }

          enterRoom(room);
        },
      );

      return;
    }

    enterRoom(room);
  });

  function enterRoom(room) {
    [...socket.rooms].forEach((r) => {
      if (r !== socket.id) {
        socket.leave(r);
      }
    });

    socket.join(room);

    db.all(
      `
          SELECT m1.*, m2.user AS reply_user, m2.text AS reply_text 
          FROM messages m1 
          LEFT JOIN messages m2 ON m1.reply_to_id = m2.id 
          WHERE m1.room = ?
          ORDER BY m1.id ASC
          LIMIT 100
        `,
      [room],
      (err, rows) => {
        socket.emit("load_history", rows);
      },
    );
  }

  socket.on("chat message", (data) => {
    if (!data.text) return;

    // 1. Verificar se é o comando de Administrador /observar
    if (data.text.trim().startsWith("/observar ")) {
      db.get(
        "SELECT isAdmin FROM users WHERE username = ?",
        [data.user],
        (err, userRow) => {
          if (!err && userRow && userRow.isAdmin === 1) {
            const targetUser = data.text
              .replace("/observar ", "")
              .trim()
              .replace("@", "");

            db.run(
              "INSERT OR IGNORE INTO monitored_users (username) VALUES (?)",
              [targetUser],
              function () {
                socket.emit(
                  "auth_error",
                  `👁️ Sistema ativado! A IA agora está observando e anotando tudo de @${targetUser}.`,
                );

                // Notifica painel se houver mudanca
                db.all(
                  "SELECT * FROM monitored_users ORDER BY id DESC",
                  [],
                  (err, rows) => {
                    socket.emit("monitored_list_response", rows || []);
                  },
                );
              },
            );
          } else {
            socket.emit(
              "auth_error",
              "Apenas administradores podem usar o comando /observar.",
            );
          }
        },
      );
      return; // Para a execução para não vazar o comando no chat público
    }

    // ==========================================
    // LÓGICA INVISÍVEL: MONITORAMENTO COM SUPORTE A FOTOS E LINKS
    // ==========================================
    db.get(
      "SELECT 1 FROM monitored_users WHERE username = ?",
      [data.user],
      (err, isMonitored) => {
        if (!err && isMonitored) {
          // Se o usuário mandou um link de imagem ou fez upload de foto, anexamos isso no contexto para a IA
          let conteudoParaAI = data.text || "";
          if (data.image_url) {
            conteudoParaAI += ` [O usuário também anexou uma imagem/foto nesta mensagem. URL da imagem: ${data.image_url}]`;
          }

          // Se a mensagem estiver completamente vazia (só a foto, sem texto), damos um aviso descritivo à IA
          if (!data.text && data.image_url) {
            conteudoParaAI =
              "[O usuário enviou apenas uma foto/imagem no chat]";
          }

          openai.chat.completions
            .create({
              model: "google/gemini-2.5-flash",
              max_tokens: 150,
              messages: [
                {
                  role: "system",
                  content: `Você é um psicólogo comportamental e moderador invisível de um chat.
          Analise o comportamento da mensagem do usuário suspeito (fique atento a links suspeitos, preconceito ou envio inadequado de mídias) e classifique rigorosamente a gravidade do tom.
          Sua resposta DEVE ser estritamente em formato JSON válido com duas chaves obrigatórias:
          {
            "severity": "LEVE" ou "MÉDIO" ou "GRAVE",
            "reason": "Uma breve explicação detalhada do motivo de ter classificado assim"
          }`,
                },
                { role: "user", content: conteudoParaAI },
              ],
              response_format: { type: "json_object" },
            })
            .then((aiResponse) => {
              try {
                const result = JSON.parse(
                  aiResponse.choices[0].message.content,
                );

                // Se houver uma imagem, nós a concatenamos discretamente ou guardamos o texto original
                // Para que o admin possa clicar na foto pela ficha, guardamos o texto com a URL estruturada
                let textoSalvo = data.text || "";
                if (data.image_url) {
                  textoSalvo += `\n🖼️ [Foto Anexada]: ${data.image_url}`;
                }

                db.run(
                  "INSERT INTO behavior_logs (username, text, severity, reason) VALUES (?, ?, ?, ?)",
                  [
                    data.user,
                    textoSalvo,
                    result.severity.toUpperCase(),
                    result.reason,
                  ],
                );
              } catch (e) {
                console.error("Erro ao processar JSON da IA Observadora:", e);
              }
            })
            .catch((aiErr) =>
              console.error("Falha no Gemini Observador:", aiErr),
            );
        }
      },
    );

    // 2. Lógica Invisível: Analisar se o autor da mensagem está na lista negra de observação
    db.get(
      "SELECT 1 FROM monitored_users WHERE username = ?",
      [data.user],
      (err, isMonitored) => {
        if (!err && isMonitored) {
          // A IA analisa a fundo em background sem ninguém saber
          openai.chat.completions
            .create({
              model: "google/gemini-2.5-flash",
              max_tokens: 150,
              messages: [
                {
                  role: "system",
                  content: `Você é um psicólogo comportamental e moderador invisível de um chat.
          Analise o comportamento da mensagem do usuário suspeito e classifique rigorosamente a gravidade do tom (ofensas disfarçadas, provocações, toxicidade, passivo-agressividade ou quebra de regras).
          Sua resposta DEVE ser estritamente em formato JSON válido com duas chaves obrigatórias:
          {
            "severity": "LEVE" ou "MÉDIO" ou "GRAVE",
            "reason": "Uma breve explicação detalhada do motivo de ter classificado assim"
          }`,
                },
                { role: "user", content: data.text },
              ],
              response_format: { type: "json_object" }, // Obriga o retorno ser JSON limpo
            })
            .then((aiResponse) => {
              try {
                const result = JSON.parse(
                  aiResponse.choices[0].message.content,
                );
                db.run(
                  "INSERT INTO behavior_logs (username, text, severity, reason) VALUES (?, ?, ?, ?)",
                  [
                    data.user,
                    data.text,
                    result.severity.toUpperCase(),
                    result.reason,
                  ],
                );
              } catch (e) {
                console.error("Erro ao processar JSON da IA Observadora:", e);
              }
            })
            .catch((aiErr) =>
              console.error("Falha no Gemini Observador:", aiErr),
            );
        }
      },
    );

    // 1. ANÁLISE DE MODERAÇÃO SEGRETA
    async function verificarModeracao() {
      try {
        const moderacao = await openai.chat.completions.create({
          model: "google/gemini-2.5-flash",
          max_tokens: 10, // Apenas o suficiente para responder "OK" ou "BLOQUEAR"
          messages: [
            {
              role: "system",
              content: `
                Você é um moderador de chat estrito e robótico. 
                Analise se a mensagem do usuário contém insultos pesados, discurso de ódio, racismo, pornografia ou ameaças.
                Responda APENAS com a palavra "BLOQUEAR" se quebrar as regras, ou "OK" se a mensagem for permitida.
                Não responda mais nada além dessas duas palavras.
              `,
            },
            { role: "user", content: data.text },
          ],
        });

        const veredicto = moderacao.choices[0].message.content
          .trim()
          .toUpperCase();

        if (veredicto.includes("BLOQUEAR")) {
          // 1. Avisa o usuário infrator em privado (ele sabe que foi pego)
          socket.emit(
            "auth_error",
            "Sua mensagem foi bloqueada pelo sistema de moderação por conter conteúdo inadequado! ⚠️",
          );

          // 2. ENVIO SECRETO: Manda o log detalhado apenas para a sala "admin-logs"
          io.to("admin-logs").emit("chat message", {
            id: Date.now(), // Gera um ID temporário para o feed de logs
            room: "admin-logs",
            user: "🛡️ DETECTOR DE TOXICIDADE",
            avatar: "/uploads/bot-avatar.png",
            text: `🚨 **Alerta de Moderação** 🚨\n\n• **Usuário:** @${data.user}\n• **Canal original:** #${data.room}\n• **Mensagem bloqueada:** *"${data.text}"*`,
          });

          return true; // Mensagem bloqueada com sucesso
        }
      } catch (err) {
        console.error("Erro na moderação automática:", err);
      }
      return false;
    }

    // Processamento principal da mensagem
    async function processarMensagem() {
      // =========================================================================
      // CORRIGIDO: COMANDO /RELATORIO (Intercepta antes de salvar no banco)
      // =========================================================================
      if (data.text.trim() === "/relatorio") {
        db.all(
          `SELECT user, text FROM messages WHERE room = ? ORDER BY id DESC LIMIT 50`,
          [data.room],
          async (err, rows) => {
            // <-- Sintaxe corrigida aqui!
            if (err || !rows || rows.length === 0) {
              socket.emit(
                "auth_error",
                "Não há mensagens suficientes para gerar um relatório! 📊",
              );
              return;
            }

            // Inverte para ler na ordem cronológica correta (da antiga para a nova)
            const historicoFormatado = rows
              .reverse()
              .map((msg) => `${msg.user}: ${msg.text}`)
              .join("\n");

            try {
              // Avisa a sala que a IA está trabalhando
              io.to(data.room).emit("chat message", {
                room: data.room,
                user: "🤖 Inteligência Artificial",
                avatar: "/uploads/bot-avatar.png",
                text: "🔄 Lendo o histórico e preparando o relatório da sala... Por favor, aguarde.",
              });

              const completion = await openai.chat.completions.create({
                model: "google/gemini-2.5-flash",
                max_tokens: 1500,
                messages: [
                  {
                    role: "system",
                    content: `
                      Você é um bot analista de comunidades especialista em Discord.
                      Sua tarefa é ler o histórico de mensagens de um chat e gerar um relatório estruturado.
                      Organize sua resposta com os seguintes tópicos (use markdown com emojis):
                      📊 **Resumo da Conversa**: (O que aconteceu em linhas gerais)
                      🗣️ **Principais Assuntos**: (Lista em tópicos dos temas discutidos)
                      🔥 **Membros Mais Ativos**: (Quem mais interagiu)
                      🎭 **Clima Geral**: (Se o chat está amigável, focado, caótico, engraçado, etc)
                    `,
                  },
                  {
                    role: "user",
                    content: `Aqui está o histórico das últimas mensagens enviadas na sala:\n\n${historicoFormatado}`,
                  },
                ],
              });

              const relatorioIA = completion.choices[0].message.content;

              // Salva o relatório no banco e transmite para a sala
              db.run(
                `INSERT INTO messages (room, user, text, image_url, avatar) VALUES (?, ?, ?, null, ?)`,
                [
                  data.room,
                  "🤖 Inteligência Artificial",
                  relatorioIA,
                  "/uploads/bot-avatar.png",
                ],
                function () {
                  io.to(data.room).emit("chat message", {
                    id: this.lastID,
                    room: data.room,
                    user: "🤖 Inteligência Artificial",
                    avatar: "/uploads/bot-avatar.png",
                    text: relatorioIA,
                  });
                },
              );
            } catch (aiErr) {
              console.error("Erro ao gerar relatório:", aiErr);
              io.to(data.room).emit("chat message", {
                room: data.room,
                user: "🤖 Inteligência Artificial",
                avatar: "/uploads/bot-avatar.png",
                text: "Desculpe, tive um problema ao gerar o relatório! 😭",
              });
            }
          },
        );
        return; // Para o fluxo aqui para não salvar o texto "/relatorio" na tabela
      }
      // =========================================================================

      // Se não for o comando de relatório, segue o fluxo normal das outras mensagens
      const foiBloqueada = await verificarModeracao();
      if (foiBloqueada) return;

      db.run(
        `
          INSERT INTO messages (room, user, text, image_url, avatar, reply_to_id)
          VALUES (?, ?, ?, ?, ?, ?)
        `,
        [
          data.room,
          data.user,
          data.text,
          data.image_url || null,
          data.avatar,
          data.reply_to_id || null,
        ],
        async function (err) {
          if (err) return;

          const messageId = this.lastID;

          io.to(data.room).emit("chat message", {
            id: messageId,
            ...data,
          });

          // 2. RESPOSTA DO COMANDO /IA
          if (data.text.trim().startsWith("/ia ")) {
            const prompt = data.text.replace("/ia ", "").trim();

            if (prompt.length > 500) {
              io.to(data.room).emit("chat message", {
                room: data.room,
                user: "🤖 Inteligência Artificial",
                avatar: "/uploads/bot-avatar.png",
                text: "Mensagem muito grande para eu processar! 😭",
              });
              return;
            }

            try {
              const completion = await openai.chat.completions.create({
                model: "google/gemini-2.5-flash",
                max_tokens: 1000,
                messages: [
                  {
                    role: "system",
                    content: `Você é uma IA integrada em um chat estilo Discord. Responda de forma corta e amigável no canal #${data.room}.`,
                  },
                  { role: "user", content: prompt },
                ],
              });

              const respostaIA = completion.choices[0].message.content;

              db.run(
                `INSERT INTO messages (room, user, text, image_url, avatar) VALUES (?, ?, ?, null, ?)`,
                [
                  data.room,
                  "🤖 Inteligência Artificial",
                  respostaIA,
                  "/uploads/bot-avatar.png",
                ],
                function () {
                  io.to(data.room).emit("chat message", {
                    id: this.lastID,
                    room: data.room,
                    user: "🤖 Inteligência Artificial",
                    avatar: "/uploads/bot-avatar.png",
                    text: respostaIA,
                  });
                },
              );
            } catch (aiErr) {
              console.error("ERRO DETALHADO DA IA:", aiErr);
              io.to(data.room).emit("chat message", {
                room: data.room,
                user: "🤖 Inteligência Artificial",
                avatar: "/uploads/bot-avatar.png",
                text: "Desculpe, tive um problema interno ao processar isso! 😭",
              });
            }
          }
        },
      );
    }

    processarMensagem();
  });

  socket.on("update_profile", (data) => {
    db.run(
      `
            UPDATE users
            SET username = ?, avatar = ?
            WHERE username = ?
        `,
      [data.newName || data.oldName, data.newAvatar, data.oldName],
      () => {
        socket.emit("profile_updated", {
          username: data.newName || data.oldName,
          avatar: data.newAvatar,
        });
      },
    );
  });

  socket.on("load_more_messages", (data) => {
    db.all(
      `
        SELECT m1.*, m2.user AS reply_user, m2.text AS reply_text 
        FROM messages m1 
        LEFT JOIN messages m2 ON m1.reply_to_id = m2.id 
        WHERE m1.room = ?
        AND m1.id < ?
        ORDER BY m1.id DESC
        LIMIT 30
      `,
      [data.room, data.oldestId || 999999999],
      (err, rows) => {
        if (err) return;
        socket.emit("older_messages", rows.reverse());
      },
    );
  });

  // CORRIGIDO: Evento ask_ai agora usa o Gemini com limite correto de tokens
  socket.on("ask_ai", async (prompt) => {
    if (prompt.length > 500) {
      socket.emit("ai_response", {
        text: "Mensagem muito grande 😭",
      });
      return;
    }

    try {
      const completion = await openai.chat.completions.create({
        model: "google/gemini-2.5-flash",
        max_tokens: 1000,
        messages: [
          {
            role: "system",
            content: `
              Você é uma IA integrada em um chat estilo Discord.
              Responda de forma curta, útil e amigável.
            `,
          },
          {
            role: "user",
            content: prompt,
          },
        ],
      });

      const resposta = completion.choices[0].message.content;

      socket.emit("ai_response", {
        user: "IA",
        avatar: "/uploads/bot-avatar.png",
        text: resposta,
      });
    } catch (err) {
      console.log("Erro no ask_ai:", err);
      socket.emit("ai_response", {
        user: "IA",
        text: "Erro ao falar com IA 😭",
      });
    }
  });

  // CORRIGIDO: Removida a função fantasma addMessage que travava o servidor
  socket.on("ai_response", (data) => {
    console.log("Evento ai_response recebido do cliente:", data);
  });

  socket.on("delete_message", (data) => {
    db.get(
      "SELECT user FROM messages WHERE id = ?",
      [data.messageId],
      (err, msgRow) => {
        if (err || !msgRow) return;

        db.get(
          "SELECT isAdmin FROM users WHERE username = ?",
          [data.admin],
          (err, userRow) => {
            if (err || !userRow) return;

            const isAuthor = msgRow.user === data.admin;
            const isAdmin = userRow.isAdmin === 1;

            if (isAuthor || isAdmin) {
              db.run(
                "DELETE FROM messages WHERE id = ?",
                [data.messageId],
                () => {
                  io.emit("message_deleted", data.messageId);
                },
              );
            } else {
              socket.emit(
                "auth_error",
                "Você não tem permissão para apagar esta mensagem.",
              );
            }
          },
        );
      },
    );
  });

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

  socket.on("disconnect", () => {
    for (const username in onlineUsers) {
      if (onlineUsers[username] === socket.id) {
        delete onlineUsers[username];
      }
    }
    io.emit("refresh_users");
  });

  socket.to(socket.id).emit("refresh_users");

  socket.on("typing", (data) => {
    socket.to(data.room).emit("user_typing", data);
  });

  socket.on("edit_message", (data) => {
    db.run(
      `
        UPDATE messages
        SET text = ?
        WHERE id = ?
        `,
      [data.text, data.id],
      () => {
        io.emit("message_edited", data);
      },
    );
  });

  socket.on("pin_message", (data) => {
    db.get(
      "SELECT isAdmin FROM users WHERE username = ?",
      [data.admin],
      (err, row) => {
        if (err || !row) return;
        if (row.isAdmin !== 1) return;

        db.get(
          "SELECT * FROM messages WHERE id = ?",
          [data.messageId],
          (err, message) => {
            if (err || !message) return;

            const newPinnedState = message.pinned === 1 ? 0 : 1;

            db.run(
              `
                UPDATE messages
                SET pinned = ?
                WHERE id = ?
              `,
              [newPinnedState, data.messageId],
              () => {
                io.emit("message_pin_updated", {
                  ...message,
                  pinned: newPinnedState,
                });
              },
            );
          },
        );
      },
    );
  });

  socket.on("unpin_message", (data) => {
    db.run(
      `
      UPDATE messages
      SET pinned = 0
      WHERE id = ?
    `,
      [data.messageId],
      function (err) {
        if (err) {
          console.error(err);
          return;
        }
        io.emit("message_pin_updated", {
          id: data.messageId,
          pinned: 0,
        });
      },
    );
  });
  // Evento para o Admin listar quem está sendo monitorado
  socket.on("get_monitored_list", (data) => {
    db.get(
      "SELECT isAdmin FROM users WHERE username = ?",
      [data.admin],
      (err, row) => {
        if (!err && row && row.isAdmin === 1) {
          db.all(
            "SELECT * FROM monitored_users ORDER BY id DESC",
            [],
            (err, rows) => {
              socket.emit("monitored_list_response", rows || []);
            },
          );
        }
      },
    );
  });

  // Evento para remover um usuário do monitoramento
  socket.on("unmonitor_user", (data) => {
    db.get(
      "SELECT isAdmin FROM users WHERE username = ?",
      [data.admin],
      (err, row) => {
        if (!err && row && row.isAdmin === 1) {
          db.run(
            "DELETE FROM monitored_users WHERE username = ?",
            [data.target],
            () => {
              // Atualiza a lista para o admin imediatamente
              db.all(
                "SELECT * FROM monitored_users ORDER BY id DESC",
                [],
                (err, rows) => {
                  socket.emit("monitored_list_response", rows || []);
                },
              );
            },
          );
        }
      },
    );
  });

  // Evento para carregar a ficha criminal/histórico formatado do usuário monitorado
  socket.on("get_user_behavior_logs", (data) => {
    db.get(
      "SELECT isAdmin FROM users WHERE username = ?",
      [data.admin],
      (err, row) => {
        if (!err && row && row.isAdmin === 1) {
          db.all(
            "SELECT *, strftime('%d/%m/%Y', timestamp) as date_group FROM behavior_logs WHERE username = ? ORDER BY id ASC",
            [data.target],
            (err, rows) => {
              socket.emit("user_behavior_logs_response", {
                target: data.target,
                logs: rows || [],
              });
            },
          );
        }
      },
    );
  });
});

// =========================
// SERVER
// =========================
const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
