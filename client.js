let incomingCallData = null;
let localOnlineUsersCache = [];
// CONTROLO DE NOTIFICAÇÕES E MENSAGENS NÃO LIDAS
let currentRoomNewMessages = 0; // Mensagens não lidas na sala ATUAL

// Solicita permissão para notificações nativas do sistema ao carregar a página
if (window.Notification && Notification.permission !== "granted" && Notification.permission !== "denied") {
  Notification.requestPermission();
}
let lastRenderedDate = null; // Controla o cabeçalho de data atual no ecrã
const socket = io();
const messagesDiv = document.getElementById("messages");

messagesDiv.addEventListener("scroll", () => {
  // =========================
  // DETECTA SE ESTÁ NO FINAL
  // =========================

  const threshold = 100;

  isUserAtBottom =
    messagesDiv.scrollHeight -
    messagesDiv.scrollTop -
    messagesDiv.clientHeight <
    threshold;

  // =========================
  // CARREGAR MAIS MENSAGENS
  // =========================

  if (messagesDiv.scrollTop <= 0 && !loadingOldMessages) {
    loadingOldMessages = true;

    const oldestMessage = document.querySelector(".message");

    const oldestId = oldestMessage?.dataset.id;

    socket.emit("load_more_messages", {
      room: currentRoom,
      oldestId,
    });

    setTimeout(() => {
      loadingOldMessages = false;
    }, 500);
  }
});

const messageInput = document.getElementById("message-input");

messageInput.addEventListener("input", () => {
  socket.emit("typing", {
    room: currentRoom,
    user: currentUser,
  });
});

let isUserAtBottom = true;
let replyingTo = null;
let loadingOldMessages = false;
let unreadMessages = {};
let currentUser = null;
let currentAvatar = "/uploads/default-avatar.png";
let currentRoom = "geral";
let isLoginMode = true;
let privateChats = JSON.parse(localStorage.getItem("privateChats")) || [];
let unreadCounts = {};

function toggleAuthMode() {
  isLoginMode = !isLoginMode;

  document.getElementById("auth-submit-btn").innerText = isLoginMode
    ? "Entrar"
    : "Registrar";

  document.getElementById("auth-toggle-text").innerText = isLoginMode
    ? "Criar conta"
    : "Já tenho conta";
}

function handleAuth() {
  const username = document.getElementById("auth-user").value;

  const password = document.getElementById("auth-pass").value;

  socket.emit(isLoginMode ? "login" : "register", { username, password });
}

socket.on("user_typing", (data) => {
  const typing = document.getElementById("typing-indicator");

  typing.innerText = `${data.user} está digitando...`;

  clearTimeout(window.typingTimeout);

  window.typingTimeout = setTimeout(() => {
    typing.innerText = "";
  }, 1500);
});

socket.on("auth_success", (data) => {
  currentUser = data.username;
  currentAvatar = data.avatar;

  window.isAdmin = data.isAdmin;

  console.log(data);
  console.log("É admin?", data.isAdmin);

  document.getElementById("auth-overlay").style.display = "none";

  document.getElementById("my-name").innerText = currentUser;

  document.getElementById("my-avatar").src = currentAvatar;

  socket.emit("switch_room", "geral");

  socket.emit("get_users");

  if (data.isAdmin === 1) {
    const eyeBtn = document.getElementById("admin-monitor-btn");
    if (eyeBtn) eyeBtn.style.display = "block";
  }

  if (data.isAdmin) {
    document.getElementById("admin-channel").classList.remove("hidden");
  }

  // === ADICIONE ESTE BLOCO AQUI ===
  const btnAdminLogs = document.getElementById("btn-admin-logs");
  if (btnAdminLogs) {
    if (data.isAdmin === 1) {
      btnAdminLogs.style.display = "flex"; // Mostra se for admin
    } else {
      btnAdminLogs.style.display = "none"; // Esconde completamente se for usuário comum
    }
  }
  // ================================

  socket.emit("switch_room", currentRoom);
});

socket.on("auth_error", alert);

function changeRoom(event, room) {
  currentRoom = room;
  messagesDiv.innerHTML = "";
  lastRenderedDate = null; // 🌟 Reset fundamental para recalcular na nova sala!

  document.getElementById("messages").innerHTML = "";

  socket.emit("switch_room", room);

  document
    .querySelectorAll(".channel-btn")
    .forEach((btn) => btn.classList.remove("active-room"));

  if (event) {
    event.currentTarget.classList.add("active-room");
  }

  document.getElementById("header-name").innerText = room;

  clearNotification(room);
}

function openDM(targetUser) {
  const username =
    typeof targetUser === "object" ? targetUser.username : targetUser;

  if (!username || username === currentUser) return;

  const room = [currentUser, username].sort().join("_pm_");

  currentRoom = room;

  document.getElementById("messages").innerHTML = "";
  lastRenderedDate = null; // 🌟 ADICIONA ESTA LINHA AQUI para limpar o controlo de data nas DMs!

  socket.emit("switch_room", room);

  const exists = privateChats.some((u) => (u.username || u) === username);

  if (!exists) {
    privateChats.push({
      username,
      avatar: targetUser.avatar || "/uploads/default-avatar.png",
    });

    localStorage.setItem("privateChats", JSON.stringify(privateChats));
  }

  renderPrivateChats();

  updateHeader(username, true);
}

function renderPrivateChats() {
  const dmList = document.getElementById("dm-list");

  dmList.innerHTML = "";

  privateChats.forEach((user) => {
    const username = user.username || user;

    const avatar = user.avatar || "/uploads/default-avatar.png";

    const div = document.createElement("div");

    div.className = "channel-btn";

    div.innerHTML = `
            <div style="
                display:flex;
                align-items:center;
                gap:8px;
            ">
                <img
                    src="${avatar}"
                    style="
                        width:32px;
                        height:32px;
                        border-radius:50%;
                        object-fit:cover;
                    "
                >

                <span>${username}</span>
            </div>
        `;

    div.onclick = () => openDM(user);

    dmList.appendChild(div);
  });
}

// EVENTO DO ENTER NO CORAÇÃO DO SEU CLIENT.JS
messageInput.addEventListener("keydown", async (e) => {
  if (e.key === "Enter") {
    const text = messageInput.value.trim();

    // 🌟 ALTERAÇÃO SEGUINTE: Bloqueia APENAS se não houver texto E não houver arquivo no preview
    if (!text && !selectedChatFile) return;

    let imageUrl = null;

    if (selectedChatFile) {
      try {
        const formData = new FormData();
        formData.append("image", selectedChatFile);

        const res = await fetch("/upload", {
          method: "POST",
          body: formData,
        });

        const uploadData = await res.json();
        imageUrl = uploadData.url;
      } catch (err) {
        console.error("Erro ao fazer upload da imagem:", err);
        alert("Houve uma falha ao processar a imagem. Tente enviar novamente.");
        return;
      }
    }

    // Envia o payload completo para o servidor
    socket.emit("chat message", {
      room: currentRoom,
      user: currentUser,
      avatar: currentAvatar,
      text: text || "", // Se não houver texto, envia uma string vazia ("") de forma segura
      image_url: imageUrl,
      reply_to_id: replyingTo ? replyingTo.id : null,
      reply_user: replyingTo ? replyingTo.user : null,
      reply_text: replyingTo ? replyingTo.text : null,
    });

    // Reseta o estado do input e do preview
    messageInput.value = "";
    replyingTo = null;
    cancelReply();
    clearChatImagePreview();
  }
});

socket.on("ai_response", (data) => {
  addMessage({
    user: "IA",
    avatar: "/uploads/default-avatar.png",
    text: data.text,
  });
});

socket.on("chat message", (data) => {
  // Verifica se a mensagem foi enviada pelo próprio usuário logado
  const isMe = data.user === currentUser;

  if (data.room === currentRoom) {
    // 🌟 SE A MENSAGEM É NA SALA ATUAL (Exibe na tela imediatamente)
    insertDateDivider(data.timestamp || new Date(), false);
    addMessage(data);

    // PARTE 2: Se não fui eu que mandei, e eu estiver com a aba do navegador escondida 
    // ou tiver subido o scroll (não estou no fundo), exibe a barra temporária no topo
    if (!isMe && (document.hidden || !isUserAtBottom)) {
      currentRoomNewMessages++;
      showUnreadBanner();
    }
  } else {
    // 🌟 SE A MENSAGEM VEIO DE OUTRA SALA / DM PRIVADA
    if (!isMe) {
      // Incrementa o contador de não lidas daquela sala específica
      unreadMessages[data.room] = (unreadMessages[data.room] || 0) + 1;

      // Mantém a tua função original de notificações ativa
      if (typeof updateNotifications === "function") {
        updateNotifications();
      }

      // PARTE 3: Cria ou atualiza a bolinha vermelha na barra lateral (limite 90+)
      updateBadgeUI(data.room, unreadMessages[data.room]);

      // PARTE 1: Envia a notificação nativa no sistema (Windows/Mac/Celular) se o chat estiver em segundo plano
      if (window.Notification && Notification.permission === "granted") {
        const title = data.room.includes("_pm_") ? `💬 DM de @${data.user}` : `📢 Canal #${data.room}`;
        new Notification(title, {
          body: data.text || "🖼️ Enviou uma imagem...",
          icon: data.avatar || "/uploads/default-avatar.png",
        });
      }
    }
  }
});

// Ouvinte para abrir o modal de chamada recebida no cliente convidado
socket.on("incoming-call", (data) => {
  // Salva os dados da chamada recebida para usar ao aceitar ou recusar
  incomingCallData = data;

  const titleEl = document.getElementById("incoming-call-title");
  const textEl = document.getElementById("incoming-call-text");
  const modalEl = document.getElementById("incoming-call-modal");

  // Atualiza dinamicamente o texto com base no tipo (vídeo/voz) e quem ligou
  if (titleEl) {
    titleEl.textContent = data.type === "video" ? "📹 Chamada de Vídeo..." : "🔊 Chamada de Voz...";
  }
  if (textEl) {
    textEl.textContent = `@${data.caller} está te convidando para uma chamada de ${data.type === "video" ? "vídeo" : "voz"}.`;
  }

  // Faz o modal embutido no HTML aparecer na tela
  if (modalEl) {
    modalEl.style.display = "flex";
  }
});

// Adicione este ouvinte no seu client.js
socket.on("load_history", (messages) => {
  // Limpa o container de mensagens para garantir que não fiquem duplicadas
  const messagesDiv = document.getElementById("messages");
  messagesDiv.innerHTML = "";

  // Reseta o divisor de data para o histórico recém-carregado
  lastRenderedDate = null;

  // Se houver mensagens no histórico, renderiza uma por uma
  if (messages && messages.length > 0) {
    messages.forEach((msg) => {
      // Insere o divisor de data discreto para cada mensagem do histórico
      if (typeof insertDateDivider === "function") {
        insertDateDivider(msg.timestamp, false);
      }

      // Adiciona a mensagem visualmente na tela
      if (typeof addMessage === "function") {
        addMessage(msg);
      }
    });
  }

  // Joga o scroll do usuário para o final para ele ver as mensagens mais recentes
  messagesDiv.scrollTop = messagesDiv.scrollHeight;
  isUserAtBottom = true;
});

function createMessageElement(data) {
  const div = document.createElement("div");

  const isMe = data.user === currentUser;

  div.className = `message ${isMe ? "sent" : "received"}`;

  div.dataset.id = data.id;

  div.innerHTML = `
    <img
      src="${data.avatar}"
      class="msg-avatar"
    >

    <div class="msg-content">

      <span class="msg-author">
        ${isMe ? "Você" : data.user}
      </span>

      <span>
        ${data.text || ""}
      </span>

      ${data.image_url
      ? `
            <img
              src="${data.image_url}"
              class="chat-img"
            >
          `
      : ""
    }

    </div>
  `;

  return div;
}

function addMessage(data) {
  const container = document.getElementById("messages");
  const div = document.createElement("div");

  div.id = `msg-${data.id}`;
  const isMe = data.user === currentUser;

  div.className = `message ${isMe ? "sent" : "received"}`;
  div.dataset.id = data.id;

  // Se o usuário der dois cliques na mensagem, ativa o modo de resposta automaticamente!
  div.ondblclick = () => {
    startReply(data.id, data.user, data.text || "Imagem");
  };

  // Trata aspas para não quebrar o HTML dos botões abaixo
  const safeUser = data.user.replace(/'/g, "\\'");
  const safeText = (data.text || "Imagem")
    .replace(/'/g, "\\'")
    .replace(/\n/g, " ");

  // Se essa mensagem for uma resposta, cria o balãozinho de citação superior
  const replyHTML = data.reply_to_id
    ? `
    <div class="reply-reference" onclick="goToPinnedMessage(${data.reply_to_id})" style="cursor: pointer; display: flex; align-items: center; gap: 5px; margin-bottom: 5px; font-size: 0.8rem; color: #b9bbbe; opacity: 0.8;">
        <span style="color: #5865f2; font-weight: bold;">⤹</span>
        <strong>@${data.reply_user}</strong>: <span style="font-style: italic; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 250px;">${data.reply_text}</span>
    </div>
  `
    : "";

  div.innerHTML = `
    <img src="${data.avatar}" class="msg-avatar">

    <div class="msg-content">

        ${replyHTML}

        <div class="message-top">

            <span class="msg-author">
                ${isMe ? "Você" : data.user}
            </span>

            <div class="message-actions">
                
                <button 
                    class="reply-btn-quick" 
                    onclick="startReply(${data.id}, '${safeUser}', '${safeText}')"
                    style="background: none; border: none; color: #b9bbbe; cursor: pointer; font-size: 0.9rem; margin-right: 4px;" 
                    title="Responder">
                    ↩️
                </button>

                ${window.isAdmin || isMe
      ? `
                    <button
                        class="menu-btn"
                        onclick="toggleMessageMenu(event, ${data.id})">
                        ⋮
                    </button>

                    <div
                        class="message-menu"
                        id="menu-${data.id}">

                        <button
                            onclick="deleteMessage(${data.id})">
                            🗑️ Apagar
                        </button>

                        ${data.pinned
        ? `
                            <button
                                class="message-action danger pin-toggle-btn"
                                onclick="unpinMessage(${data.id})">
                                Desfixar
                            </button>
                          `
        : `
                            <button
                                class="message-action pin-toggle-btn"
                                onclick="pinMessage(${data.id})">
                                Fixar
                            </button>
                           `
      }
                        ${isMe
        ? `
                          <button
                              class="edit-btn"
                              onclick="editMessage(${data.id})">
                              Editar
                          </button>
                        `
        : ""
      }
                    </div>
                `
      : ""
    }

            </div>

        </div>

        <span>${data.text || ""}</span>

        ${data.image_url ? `<img src="${data.image_url}" class="chat-img">` : ""
    }

    </div>
  `;

  container.appendChild(div);

  if (isUserAtBottom) {
    container.scrollTo({
      top: container.scrollHeight,
      behavior: "smooth",
    });
  }
}



socket.on("refresh_users", () => {
  socket.emit("get_users");
});

socket.on("user_list", (users) => {
  localOnlineUsersCache = users;
  const list = document.getElementById("user-list");

  list.innerHTML = "";

  document.getElementById("user-count").innerText = users.length;

  users.forEach((user) => {
    if (user.username === currentUser) return;

    const div = document.createElement("div");

    div.className = "user-item";

    div.onclick = () => openDM(user);

    div.innerHTML = `
    <div class="user-left">

        <div class="status-dot ${user.online ? "online" : "offline"}"></div>

        <img src="${user.avatar}" class="user-avatar">

        <span>${user.username}</span>

    </div>

    ${window.isAdmin
        ? `
        <div class="admin-actions">

            ${user.isMuted
          ? `
                <button
                    class="admin-btn btn-unmute"
                    onclick="event.stopPropagation(); unmuteUser('${user.username}')">
                    Unmute
                </button>
            `
          : `
                <button
                    class="admin-btn btn-mute"
                    onclick="event.stopPropagation(); muteUser('${user.username}')">
                    Mute
                </button>
            `
        }
             ${user.isBanned
          ? ""
          : `
            <button
                class="admin-btn btn-ban"
                onclick="event.stopPropagation(); banUser('${user.username}')">
                Ban
            </button>
            `
        }

        </div>
    `
        : ""
      }
`;

    list.appendChild(div);
  });
});

function muteUser(username) {
  socket.emit("mute_user", {
    admin: currentUser,
    target: username,
  });
}

function unmuteUser(username) {
  socket.emit("unmute_user", {
    admin: currentUser,
    target: username,
  });
}

function banUser(username) {
  const confirmar = confirm(`Banir ${username}?`);

  if (!confirmar) return;

  socket.emit("ban_user", {
    admin: currentUser,
    target: username,
  });
}

function editMessage(id) {
  const novoTexto = prompt("Editar mensagem:");

  if (!novoTexto) return;

  socket.emit("edit_message", {
    id,
    text: novoTexto,
  });
}

function addNotification(room) {
  unreadCounts[room] = (unreadCounts[room] || 0) + 1;

  const badge = document.getElementById(`badge-${room}`);

  if (!badge) return;

  badge.classList.remove("hidden");

  badge.innerText = unreadCounts[room];
}

function clearNotification(room) {
  unreadCounts[room] = 0;

  const badge = document.getElementById(`badge-${room}`);

  if (!badge) return;

  badge.classList.add("hidden");
}

document.getElementById("search-input").addEventListener("input", (e) => {
  const term = e.target.value.toLowerCase();

  document.querySelectorAll(".message").forEach((msg) => {
    msg.style.display = msg.innerText.toLowerCase().includes(term)
      ? "flex"
      : "none";
  });
});

async function sendPhoto() {
  const file = document.getElementById("file-image").files[0];

  const formData = new FormData();

  formData.append("image", file);

  const res = await fetch("/upload", {
    method: "POST",
    body: formData,
  });

  const data = await res.json();

  socket.emit("chat message", {
    room: currentRoom,
    user: currentUser,
    avatar: currentAvatar,
    image_url: data.url,
  });
}

function toggleModal(id, show) {
  document.getElementById(id).style.display = show ? "flex" : "none";
}

function previewFile() {
  const file = document.getElementById("file-avatar").files[0];

  const reader = new FileReader();

  reader.onloadend = () => {
    document.getElementById("preview-img").src = reader.result;
  };

  reader.readAsDataURL(file);
}

async function saveProfile() {
  const file = document.getElementById("file-avatar").files[0];

  const newName = document.getElementById("new-name").value;

  let avatar = currentAvatar;

  if (file) {
    const formData = new FormData();

    formData.append("image", file);

    const res = await fetch("/upload", {
      method: "POST",
      body: formData,
    });

    const data = await res.json();

    avatar = data.url;
  }

  socket.emit("update_profile", {
    oldName: currentUser,
    newName,
    newAvatar: avatar,
  });
}

socket.on("profile_updated", (data) => {
  currentUser = data.username;
  currentAvatar = data.avatar;

  document.getElementById("my-name").innerText = currentUser;

  document.getElementById("my-avatar").src = currentAvatar;

  toggleModal("settings-modal", false);
});

function logout() {
  location.reload();
}

function updateNotifications() {
  document.querySelectorAll(".channel-btn").forEach((btn) => {
    const room = btn.dataset.room;

    if (!room) return;

    const count = unreadMessages[room] || 0;

    let badge = btn.querySelector(".notif-badge");

    if (count > 0) {
      if (!badge) {
        badge = document.createElement("span");

        badge.className = "notif-badge";

        btn.appendChild(badge);
      }

      badge.innerText = count;
    } else {
      if (badge) badge.remove();
    }
  });
}

socket.on("older_messages", (rows) => {
  const container = document.getElementById("messages");

  const oldHeight = container.scrollHeight;

  rows.forEach((msg) => {
    const div = createMessageElement(msg);

    container.prepend(div);
  });

  const newHeight = container.scrollHeight;

  container.scrollTop = newHeight - oldHeight;
});

function editMessage(id) {
  const novoTexto = prompt("Editar mensagem:");

  if (!novoTexto) return;

  socket.emit("edit_message", {
    id,
    text: novoTexto,
  });
}

socket.on("message_edited", (data) => {
  const mensagens = document.querySelectorAll(".message");

  mensagens.forEach((msg) => {
    const button = msg.querySelector(".edit-btn");

    if (button && button.getAttribute("onclick").includes(data.id)) {
      const texto = msg.querySelector(".msg-text");

      texto.innerText = data.text + " (editado)";
    }
  });
});

function toggleTheme() {
  document.body.classList.toggle("light-theme");
}

function deleteMessage(messageId) {
  socket.emit("delete_message", {
    messageId,
    admin: currentUser,
  });
}

socket.on("message_deleted", (messageId) => {
  const msg = document.getElementById(`msg-${messageId}`);

  if (msg) {
    msg.remove();
  }
});

function pinMessage(messageId) {
  socket.emit("pin_message", {
    messageId,
    admin: currentUser,
  });
}

function toggleMessageMenu(event, id) {
  event.stopPropagation();

  document.querySelectorAll(".message-menu").forEach((menu) => {
    if (menu.id !== `menu-${id}`) {
      menu.style.display = "none";
    }
  });

  const menu = document.getElementById(`menu-${id}`);

  menu.style.display = menu.style.display === "flex" ? "none" : "flex";
}

document.addEventListener("click", () => {
  document.querySelectorAll(".message-menu").forEach((menu) => {
    menu.style.display = "none";
  });
});

function goToPinnedMessage(messageId) {
  const message = document.getElementById(`msg-${messageId}`);

  if (!message) return;

  message.scrollIntoView({
    behavior: "smooth",
    block: "center",
  });

  message.classList.add("highlight-message");

  setTimeout(() => {
    message.classList.remove("highlight-message");
  }, 3000);
}

socket.on("message_pin_updated", (messageData) => {
  const message = document.querySelector(
    `.message[data-id="${messageData.id}"]`,
  );

  if (message) {
    const pinBtn = message.querySelector(".pin-toggle-btn");

    if (pinBtn) {
      if (messageData.pinned === 1) {
        pinBtn.innerText = "Desfixar";

        pinBtn.setAttribute("onclick", `unpinMessage(${messageData.id})`);
      } else {
        pinBtn.innerText = "Fixar";

        pinBtn.setAttribute("onclick", `pinMessage(${messageData.id})`);
      }
    }
  }

  const container = document.getElementById("pinned-message-container");

  const content = document.getElementById("pinned-message-content");

  if (messageData.pinned === 1) {
    container.classList.remove("hidden");

    content.innerHTML = `
      <div class="pinned-top-bar">

          <div
            class="pinned-message-clickable"
            onclick="goToPinnedMessage(${messageData.id})">

              <strong>${messageData.user}</strong>

              <span>
                ${messageData.text || "Imagem"}
              </span>

          </div>

          ${window.isAdmin
        ? `
              <button
                class="unpin-top-btn"
                onclick="unpinMessage(${messageData.id})">
                Desfixar
              </button>
            `
        : ""
      }

      </div>
    `;
  } else {
    container.classList.add("hidden");
  }
});

socket.on("message_unpinned", ({ messageId }) => {
  const message = document.querySelector(`.message[data-id="${messageId}"]`);

  if (!message) return;

  const isPinned = message.querySelector(".danger pin-toggle-btn");

  if (isPinned) {
    isPinned.innerText = "Fixar";

    isPinned.setAttribute("onclick", `pinMessage(${messageId})`);
  }

  const pinnedContainer = document.getElementById("pinned-message-container");

  pinnedContainer.classList.add("hidden");
});

function unpinMessage(messageId) {
  socket.emit("unpin_message", {
    messageId,
  });
}

const searchBtn = document.getElementById("search-toggle-btn");

const searchContainer = document.getElementById("search-container");

const searchInput = document.getElementById("search-input");

searchBtn.addEventListener("click", () => {
  searchContainer.classList.toggle("active");

  if (searchContainer.classList.contains("active")) {
    searchContainer.classList.remove("hidden-search");

    searchInput.focus();
  } else {
    searchContainer.classList.add("hidden-search");

    searchInput.value = "";

    // resetar mensagens
    document.querySelectorAll(".message").forEach((msg) => {
      msg.style.display = "flex";
    });
  }
});

function toggleLeftSidebar() {
  const sidebar = document.getElementById("left-sidebar");

  sidebar.classList.toggle("hidden-sidebar");
}

function toggleRightSidebar() {
  const sidebar = document.getElementById("right-sidebar");

  sidebar.classList.toggle("hidden-sidebar");
}

// Ativa o modo de resposta guardando os dados da mensagem pai
function startReply(messageId, user, text) {
  replyingTo = { id: messageId, user: user, text: text };

  const previewBox = document.getElementById("reply-preview-box");
  const previewText = document.getElementById("reply-preview-text");

  previewText.innerText = `Respondendo a @${user}: "${text.substring(0, 30)}${text.length > 30 ? "..." : ""}"`;
  previewBox.style.display = "flex";

  document.getElementById("message-input").focus();
}

// Cancela e fecha a barra de resposta
function cancelReply() {
  replyingTo = null;
  document.getElementById("reply-preview-box").style.display = "none";
}

// Abrir/Fechar Painel Principal
function toggleMonitorPanel() {
  const modal = document.getElementById("monitor-modal");
  if (modal.style.display === "none" || modal.style.display === "") {
    modal.style.display = "flex";
    socket.emit("get_monitored_list", { admin: currentUser });
  } else {
    modal.style.display = "none";
  }
}

// Receber a lista de monitorados do Servidor e montar os botões de ação
socket.on("monitored_list_response", (users) => {
  const container = document.getElementById("monitor-list-content");
  container.innerHTML = "";

  if (users.length === 0) {
    container.innerHTML = `<p style="color: #72767d; text-align: center; font-size: 0.9rem; padding: 10px;">Nenhum usuário sob investigação no momento.</p>`;
    return;
  }

  users.forEach((u) => {
    const div = document.createElement("div");
    div.className = "monitor-row";
    div.innerHTML = `
      <span style="font-weight: bold; color: #fff;">@${u.username}</span>
      <div style="display:flex; gap: 6px;">
         <button class="btn" style="background:#5865F2; padding: 5px 10px; font-size:0.8rem;" onclick="viewUserLogs('${u.username}')">📋 Ficha</button>
         <button class="btn" style="background:#ed4245; padding: 5px 10px; font-size:0.8rem;" onclick="stopMonitoring('${u.username}')">❌ Parar</button>
      </div>
    `;
    container.appendChild(div);
  });
});

// Ações disparadas pelos botões do painel
function stopMonitoring(targetUser) {
  if (confirm(`Remover @${targetUser} do monitoramento rigoroso?`)) {
    socket.emit("unmonitor_user", { admin: currentUser, target: targetUser });
  }
}

function viewUserLogs(targetUser) {
  socket.emit("get_user_behavior_logs", {
    admin: currentUser,
    target: targetUser,
  });
}

// Receber os registros minuciosos da IA e organizar por Linha do Tempo (Estilo WhatsApp)
socket.on("user_behavior_logs_response", (data) => {
  document.getElementById("behavior-title-name").innerText =
    `📋 Histórico e Notas da IA: @${data.target}`;
  const timeline = document.getElementById("behavior-timeline");
  timeline.innerHTML = "";

  if (data.logs.length === 0) {
    timeline.innerHTML = `<p style="color:#72767d; text-align:center; padding:20px;">Nenhuma mensagem capturada ou analisada ainda.</p>`;
    toggleModal("behavior-details-modal", true);
    return;
  }

  let lastDateGroup = "";

  data.logs.forEach((log) => {
    // Divisor de dia/mês/ano estilo WhatsApp
    if (log.date_group !== lastDateGroup) {
      lastDateGroup = log.date_group;
      const dateDivider = document.createElement("div");
      dateDivider.className = "timeline-date-divider";
      dateDivider.innerHTML = `<span>${log.date_group}</span>`;
      timeline.appendChild(dateDivider);
    }

    // Caixa da mensagem analisada com a cor baseada na infração
    const item = document.createElement("div");
    item.className = `log-item-box border-${log.severity}`;
    item.innerHTML = `
      <div style="display:flex; justify-content:space-between; margin-bottom: 5px; align-items: center;">
         <span style="color:#fff; font-size:0.85rem; font-weight:bold;">Mensagem capturada:</span>
         <span class="severity-badge severity-${log.severity}">${log.severity}</span>
      </div>
      <p style="color:#dcddde; font-size:0.95rem; background:#202225; padding:8px; border-radius:4px; margin-bottom:6px;">"${log.text}"</p>
      <div style="font-size:0.78rem; color:#b9bbbe;">
         <strong style="color:#faa61a;">🕵️ Nota da IA:</strong> ${log.reason}
      </div>
    `;
    timeline.appendChild(item);
  });

  toggleModal("behavior-details-modal", true);
});

// Variável global para armazenar temporariamente o arquivo selecionado no chat
let selectedChatFile = null;

// Evento que detecta quando o usuário escolhe uma imagem ou GIF
document.getElementById("file-image").addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;

  selectedChatFile = file;

  // Ler o arquivo localmente para gerar a miniatura (Preview)
  const reader = new FileReader();
  reader.onload = (event) => {
    const previewContainer = document.getElementById("chat-preview-container");
    const previewImg = document.getElementById("chat-preview-img");

    if (previewContainer && previewImg) {
      previewImg.src = event.target.result;
      previewContainer.style.display = "flex"; // Mostra a barra de preview
    }
  };
  reader.readAsDataURL(file);
});

// Função para cancelar/remover o preview da imagem
function clearChatImagePreview() {
  selectedChatFile = null;
  document.getElementById("file-image").value = ""; // Reseta o input file
  const previewContainer = document.getElementById("chat-preview-container");
  if (previewContainer) {
    previewContainer.style.display = "none";
  }
}

// Função para inserir um divisor de data discreto no chat
function insertDateDivider(timestamp, prepend = false) {
  if (!timestamp) return;

  // Formata a data da mensagem para o padrão DD/MM/AAAA
  const msgDate = new Date(timestamp);
  const formattedDate = msgDate.toLocaleDateString("pt-PT", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });

  // Se a data não mudou, não faz nada
  if (!prepend && lastRenderedDate === formattedDate) return;

  const divider = document.createElement("div");
  divider.className = "chat-date-divider";
  divider.setAttribute("data-date", formattedDate);
  divider.innerHTML = `<span>${formattedDate}</span>`;

  if (prepend) {
    // Para mensagens antigas carregadas via scroll (se aplicares paginação no futuro)
    messagesDiv.insertBefore(divider, messagesDiv.firstChild);
  } else {
    // Para o fluxo normal de mensagens novas ou carregamento inicial
    messagesDiv.appendChild(divider);
    lastRenderedDate = formattedDate;
  }

  // PARTE 2: Gerencia a barra flutuante temporária no topo do chat
  function showUnreadBanner() {
    if (currentRoomNewMessages <= 0) return;

    let banner = document.getElementById("unread-messages-banner");
    const chatArea = document.querySelector(".chat-area");

    if (!banner && chatArea) {
      banner = document.createElement("div");
      banner.id = "unread-messages-banner";
      banner.className = "unread-messages-banner";
      // Insere logo no topo da área de chat, acima da lista de mensagens
      chatArea.insertBefore(banner, messagesDiv);
    }

    banner.innerHTML = `<span>⬆️ Tens ${currentRoomNewMessages} novas mensagens não lidas</span>`;
    banner.style.display = "flex";

    // Função interna para sumir com a barra assim que houver atividade na tela
    const removeBanner = () => {
      banner.style.opacity = "0";
      setTimeout(() => {
        if (banner) banner.style.display = "none";
        currentRoomNewMessages = 0;
      }, 200);

      // Remove os ouvintes para não sobrecarregar a memória
      window.removeEventListener("click", removeBanner);
      window.removeEventListener("mousemove", removeBanner);
      window.removeEventListener("keydown", removeBanner);
      messagesDiv.removeEventListener("scroll", removeBanner);
    };

    // Ativa os gatilhos para sumir a barra discretamente por movimento/clique
    setTimeout(() => {
      window.addEventListener("click", removeBanner);
      window.addEventListener("mousemove", removeBanner);
      window.addEventListener("keydown", removeBanner);
      messagesDiv.addEventListener("scroll", removeBanner);
    }, 100);
  }

  // PARTE 3: Atualiza dinamicamente as bolinhas de destaque (Badges) com limite de 90+
  function updateBadgeUI(room, count) {
    let elementSelector = "";

    if (room.includes("_pm_")) {
      // Descobre o nome do outro usuário na DM
      const participants = room.split("_pm_");
      const targetUser = participants[0] === currentUser ? participants[1] : participants[0];

      // Procura na barra lateral o item do usuário correspondente
      // Dica: Certifique-se de adicionar id ou data-username na criação da lista de DMs
      elementSelector = `.private-chat-item[data-username="${targetUser}"], .user-item[data-username="${targetUser}"]`;
    } else {
      // Procura o canal/sala correspondente (ex: canal geral)
      elementSelector = `.room-item[data-room="${room}"], #room-${room}`;
    }

    const container = document.querySelector(elementSelector);
    if (!container) return;

    // Garante que o elemento pai tenha posição relativa para o alinhamento da badge
    container.style.position = "relative";

    let badge = container.querySelector(".unread-badge");

    if (count <= 0) {
      if (badge) badge.remove();
      return;
    }

    if (!badge) {
      badge = document.createElement("span");
      badge.className = "unread-badge";
      container.appendChild(badge);
    }

    // Regra estrita: Se passar de 90 exibe "90+"
    badge.textContent = count > 90 ? "90+" : count;
  }

  // Função para limpar as notificações ao entrar numa sala ou DM
  function clearRoomNotifications(room) {
    unreadMessages[room] = 0;
    updateBadgeUI(room, 0);

    // Limpa também o banner temporário se houver
    const banner = document.getElementById("unread-messages-banner");
    if (banner) banner.style.display = "none";
    currentRoomNewMessages = 0;
  }
}

// CONTROLES GLOBAIS DE MULTIMÍDIA WEBRTC
let localStream = null;
let screenStream = null;
let peerConnections = {}; // Guarda conexões por usuário: { "username": RTCPeerConnection }
let selectedInviteUsers = new Set();
let currentCallRoom = null;
let currentCallType = "audio";
let pendingCallData = null;
let audioAnalyserInterval = null;

// Configuração padrão de servidores STUN públicos da Google (essenciais para WebRTC quebrar o firewall)
const rtcConfig = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
};

function openInviteModal(type) {
  currentCallType = type;
  selectedInviteUsers.clear();
  document.getElementById("call-invite-modal").style.display = "flex";

  renderInviteUsersList(localOnlineUsersCache);
}

// Função auxiliar para renderizar a lista (usada também pelo filtro de busca)
function renderInviteUsersList(usersArray) {
  const container = document.getElementById("invite-users-list");
  if (!container) return;
  container.innerHTML = "";

  // Filtra para remover você mesmo e garantir que só apareçam usuários de fato online
  const activeList = usersArray.filter(u => u.username !== currentUser && u.online);

  if (activeList.length === 0) {
    container.innerHTML = `<div style="padding:10px;color:#aaa;text-align:center;">Nenhum usuário online para convidar... 😢</div>`;
    return;
  }

  activeList.forEach(user => {
    const div = document.createElement("div");
    div.className = "invite-user-item";
    div.setAttribute("data-username", user.username);

    // Altera o estado visual ao clicar na linha inteira para ficar mais confortável
    div.onclick = (e) => {
      // Evita o clique duplo caso clique diretamente no checkbox
      if (e.target.tagName === "INPUT") return;
      const cb = div.querySelector('input[type="checkbox"]');
      cb.checked = !cb.checked;
      toggleSelectUserCall(cb, user.username);
    };

    div.innerHTML = `
      <div style="display:flex; align-items:center; gap:10px;">
        <img src="${user.avatar || "/uploads/default-avatar.png"}" style="width:30px; height:30px; border-radius:50%; object-fit:cover;">
        <span>@${user.username}</span>
      </div>
      <input type="checkbox" value="${user.username}" onchange="toggleSelectUserCall(this, '${user.username}')">
    `;
    container.appendChild(div);
  });
}

function closeInviteModal() {
  document.getElementById("call-invite-modal").style.display = "none";
}

function toggleSelectUserCall(checkbox, username) {
  if (checkbox.checked) {
    selectedInviteUsers.add(username);
    checkbox.parentElement.classList.add("selected");
  } else {
    selectedInviteUsers.delete(username);
    checkbox.parentElement.classList.remove("selected");
  }
}

// Inicia o disparo de convites via Socket
function initiateCallFlow() {
  if (selectedInviteUsers.size === 0) {
    alert("Selecione pelo menos 1 usuário para chamar!");
    return;
  }

  currentCallRoom = currentRoom; // Vincula a chamada ao canal de texto atual
  const targets = Array.from(selectedInviteUsers);

  // Avisa o servidor
  socket.emit("call-invite-payload", {
    targets: targets,
    room: currentCallRoom,
    caller: currentUser,
    callType: currentCallType
  });

  closeInviteModal();
  startLocalMediaAndShowUI();
}

// Configura Câmera e Microfone Local
async function startLocalMediaAndShowUI() {
  document.getElementById("active-call-overlay").style.display = "flex";

  try {
    // Captura áudio e vídeo dependendo do tipo selecionado
    localStream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: currentCallType === "video"
    });

    // Renderiza o próprio card na tela
    createParticipantCard(currentUser, localStream, true);
    setupAudioSpeakingDetector(localStream, currentUser);

  } catch (err) {
    console.error("Erro ao obter mídias locais:", err);
    alert("Não foi possível acessar sua câmera ou microfone.");
    hangUpCall();
  }
}

// Escuta Convites de Chamadas Recebidas
// Ouvir quando o servidor repassar uma chamada recebida para você
socket.on("incoming-call-broadcast", (data) => {
  console.log("[CLIENT] Recebeu convite de chamada!", data);

  incomingCallData = {
    caller: data.caller,
    room: data.room,
    type: data.callType,
    targets: data.allTargets
  };

  const callTextElem = document.getElementById("incoming-call-text");
  if (callTextElem) {
    callTextElem.textContent = `${data.caller} está convidando você para uma chamada de ${data.callType === 'video' ? 'Vídeo' : 'Áudio'}.`;
  }

  const modal = document.getElementById("incoming-call-modal");
  if (modal) {
    modal.style.display = "flex"; // Abre o modal na tela do convidado
  }
});

function declineIncomingCall() {
  document.getElementById("call-incoming-modal").style.display = "none";
  if (!pendingCallData) return;

  socket.emit("call-response-signal", {
    caller: pendingCallData.caller,
    responder: currentUser,
    accepted: false,
    room: pendingCallData.room
  });
  pendingCallData = null;
}

async function acceptIncomingCall() {
  document.getElementById("call-incoming-modal").style.display = "none";
  if (!pendingCallData) return;

  currentCallRoom = pendingCallData.room;
  currentCallType = pendingCallData.callType;

  socket.emit("call-response-signal", {
    caller: pendingCallData.caller,
    responder: currentUser,
    accepted: true,
    room: pendingCallData.room
  });

  await startLocalMediaAndShowUI();

  // Estabelece canal WebRTC inicial com quem ligou
  setupPeerConnection(pendingCallData.caller, true);
  pendingCallData = null;
}

// O Criador da chamada monitora quem aceitou para disparar a oferta WebRTC
socket.on("call-response-received", (data) => {
  if (!data.accepted) {
    console.log(`@${data.responder} recusou a chamada.`);
    return;
  }
  // Cria canal de transmissão direta para este utilizador específico
  setupPeerConnection(data.responder, false);
});

// Configuração do Pipeline WebRTC para cada usuário conectado
function setupPeerConnection(targetUser, isIncoming) {
  if (peerConnections[targetUser]) return;

  const pc = new RTCPeerConnection(rtcConfig);
  peerConnections[targetUser] = pc;

  // Injeta os tracks de áudio/vídeo locais na conexão deste peer
  localStream.getTracks().forEach(track => pc.addTrack(track, localStream));

  // Evento disparado quando o outro lado enviar o sinal de vídeo/áudio dele
  pc.ontrack = (event) => {
    createParticipantCard(targetUser, event.streams[0], false);
    setupAudioSpeakingDetector(event.streams[0], targetUser);
  };

  // Evento disparado para rotear caminhos alternativos de rede de internet
  pc.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit("webrtc-signaling-mesh", {
        to: targetUser,
        from: currentUser,
        signal: { candidate: event.candidate }
      });
    }
  };

  // Criação automática do Handshake (SDP)
  if (!isIncoming) {
    pc.createOffer()
      .then(offer => pc.setLocalDescription(offer))
      .then(() => {
        socket.emit("webrtc-signaling-mesh", {
          to: targetUser,
          from: currentUser,
          signal: { sdp: pc.localDescription }
        });
      });
  }
}

// Gerencia a troca de pacotes de sinalização WebRTC Mesh
socket.on("webrtc-signaling-mesh", async (data) => {
  let pc = peerConnections[data.from];

  if (!pc) {
    setupPeerConnection(data.from, true);
    pc = peerConnections[data.from];
  }

  if (data.signal.sdp) {
    await pc.setRemoteDescription(new RTCSessionDescription(data.signal.sdp));
    if (pc.remoteDescription.type === "offer") {
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket.emit("webrtc-signaling-mesh", {
        to: data.from,
        from: currentUser,
        signal: { sdp: pc.localDescription }
      });
    }
  } else if (data.signal.candidate) {
    try {
      await pc.addIceCandidate(new RTCIceCandidate(data.signal.candidate));
    } catch (e) {
      console.error("Falha ao adicionar ICE Candidate", e);
    }
  }
});

// Criação dinâmica da interface do usuário no Grid (Cards de vídeo e avatar)
function createParticipantCard(username, stream, isMe) {
  let card = document.getElementById(`p-card-${username}`);
  const grid = document.getElementById("call-participants-grid");

  if (!card) {
    card = document.createElement("div");
    card.id = `p-card-${username}`;
    card.className = "participant-card";

    // Injeta a estrutura HTML padrão
    card.innerHTML = `
      <img class="participant-avatar-view" id="p-avatar-${username}" src="/uploads/default-avatar.png" style="display:none;">
      <video id="p-video-${username}" autoplay playsinline ${isMe ? "muted" : ""}></video>
      <div class="participant-name">${username} ${isMe ? "(Você)" : ""}</div>
    `;
    grid.appendChild(card);

    // Se não for você, tenta buscar o avatar correto na barra lateral
    if (!isMe) {
      const userItem = document.querySelector(`.user-item[data-username="${username}"] img, .private-chat-item[data-username="${username}"] img`);
      if (userItem) {
        document.getElementById(`p-avatar-${username}`).src = userItem.src;
      }
    } else if (currentAvatar) {
      document.getElementById(`p-avatar-${username}`).src = currentAvatar;
    }
  }

  const videoElement = document.getElementById(`p-video-${username}`);

  if (videoElement.srcObject !== stream) {
    videoElement.srcObject = stream;
  }

  // Executa a verificação inicial de mídia
  updateCardMediaState(card, stream, videoElement, username);

  // Monitora mutações nas faixas de vídeo (caso o usuário ligue/desligue a câmera no meio da chamada)
  stream.onaddtrack = () => updateCardMediaState(card, stream, videoElement, username);
  stream.onremovetrack = () => updateCardMediaState(card, stream, videoElement, username);

  // Cria um intervalo temporário curto para garantir o re-calculo após o handshake do WebRTC
  setTimeout(() => {
    updateCardMediaState(card, stream, videoElement, username);
  }, 800);
}

// Função auxiliar essencial para alternar as classes CSS baseadas no estado real do Stream
function updateCardMediaState(card, stream, videoElement, username) {
  if (!stream || !card) return;

  const videoTracks = stream.getVideoTracks();
  // Está no modo de vídeo se houver faixa de vídeo e ela estiver habilitada
  const hasVideoActive = videoTracks.length > 0 && videoTracks[0].enabled;
  const avatarElement = document.getElementById(`p-avatar-${username}`);

  if (hasVideoActive) {
    // 🎥 Modo Vídeo Ativo
    card.classList.remove("audio-mode");
    videoElement.style.display = "block";
    if (avatarElement) avatarElement.style.display = "none";
  } else {
    // 🔊 Modo Apenas Voz Ativo
    card.classList.add("audio-mode");
    videoElement.style.display = "none";
    if (avatarElement) avatarElement.style.display = "block";
  }
}

// 🔊 🌟 ANALISADOR DE ÁUDIO DE ALTA VELOCIDADE (Efeito de Brilho de Fala Verde)
function setupAudioSpeakingDetector(stream, username) {
  if (stream.getAudioTracks().length === 0) return;

  const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  const source = audioCtx.createMediaStreamSource(stream);
  const analyser = audioCtx.createAnalyser();
  analyser.fftSize = 512;
  source.connect(analyser);

  const bufferLength = analyser.frequencyBinCount;
  const dataArray = new Uint8Array(bufferLength);

  const checkVolume = () => {
    const card = document.getElementById(`p-card-${username}`);
    if (!card) return; // Se o usuário saiu, encerra loop

    analyser.getByteFrequencyData(dataArray);
    let total = 0;
    for (let i = 0; i < bufferLength; i++) {
      total += dataArray[i];
    }
    const averageVolume = total / bufferLength;

    // Threshold de volume: Se a média de captação for maior que 12, considera-se falando
    if (averageVolume > 12) {
      card.classList.add("speaking");
    } else {
      card.classList.remove("speaking");
    }

    // Mantém o ciclo vivo se a chamada estiver de pé
    if (localStream) requestAnimationFrame(checkVolume);
  };

  checkVolume();
}

// CONTROLES DE MUTAÇÃO (MICROFONE, CAMERA E SCREEN SHARE)
function toggleMicrophone() {
  const audioTrack = localStream.getAudioTracks()[0];
  if (audioTrack) {
    audioTrack.enabled = !audioTrack.enabled;
    document.getElementById("btn-toggle-mic").classList.toggle("off", !audioTrack.enabled);
    document.getElementById("btn-toggle-mic").textContent = audioTrack.enabled ? "🎙️" : "🔇";
  }
}

function toggleCamera() {
  const videoTrack = localStream.getVideoTracks()[0];
  if (videoTrack) {
    videoTrack.enabled = !videoTrack.enabled;
    document.getElementById("btn-toggle-cam").classList.toggle("off", !videoTrack.enabled);
    document.getElementById("btn-toggle-cam").textContent = videoTrack.enabled ? "📹" : "🚫";

    // Alterna visualização do card local
    document.getElementById(`p-video-${currentUser}`).style.display = videoTrack.enabled ? "block" : "none";
    document.getElementById(`p-avatar-${currentUser}`).style.display = videoTrack.enabled ? "none" : "block";
  }
}

// 🖥️ TRANSMISSÃO DE TELA FORA DO NAVEGADOR (NATIVO DO SISTEMA OPERACIONAL)
async function toggleScreenShare() {
  const screenBtn = document.getElementById("btn-share-screen");

  if (!screenStream) {
    try {
      // Captura de tela nativa (abre pop-up nativo do Windows/Mac para escolher janela, tela inteira ou som)
      screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: true // Captura o áudio do sistema caso o usuário marque a caixinha
      });

      const videoTrack = screenStream.getVideoTracks()[0];

      // Substitui o track de vídeo em todas as conexões ativas P2P
      Object.values(peerConnections).forEach(pc => {
        const sender = pc.getSenders().find(s => s.track.kind === "video");
        if (sender) sender.replaceTrack(videoTrack);
      });

      createParticipantCard(currentUser, screenStream, true);
      screenBtn.textContent = "🛑 Parar Transmissão";
      screenBtn.classList.add("off");

      // Deteta se o utilizador clicou no botão nativo "Parar partilha" flutuante do SO
      videoTrack.onended = () => toggleScreenShare();

    } catch (err) {
      console.error("Falha ao compartilhar tela:", err);
    }
  } else {
    // Para a transmissão e retorna para a câmera padrão
    screenStream.getTracks().forEach(track => track.stop());
    screenStream = null;

    const cameraTrack = localStream.getVideoTracks()[0];
    Object.values(peerConnections).forEach(pc => {
      const sender = pc.getSenders().find(s => s.track.kind === "video");
      if (sender && cameraTrack) sender.replaceTrack(cameraTrack);
    });

    createParticipantCard(currentUser, localStream, true);
    screenBtn.textContent = "🖥️ Transmitir Tela";
    screenBtn.classList.remove("off");
  }
}

// Finaliza ou Abandona a chamada
function hangUpCall() {
  if (currentCallRoom) {
    socket.emit("leave-call-room", { room: currentCallRoom, user: currentUser });
  }

  // Limpa streams de hardware
  if (localStream) localStream.getTracks().forEach(track => track.stop());
  if (screenStream) screenStream.getTracks().forEach(track => track.stop());

  // Fecha conexões com todos os peers
  Object.values(peerConnections).forEach(pc => pc.close());

  // Reseta estados
  localStream = null;
  screenStream = null;
  peerConnections = {};
  currentCallRoom = null;

  // Limpa layout
  document.getElementById("call-participants-grid").innerHTML = "";
  document.getElementById("active-call-overlay").style.display = "none";

  // Reseta estilo dos botões controladores
  document.getElementById("btn-toggle-mic").classList.remove("off");
  document.getElementById("btn-toggle-cam").classList.remove("off");
  document.getElementById("btn-share-screen").classList.remove("off");
  document.getElementById("btn-share-screen").textContent = "🖥️ Transmitir Tela";
}

// Remove o card de um usuário se ele desligar/sair da chamada
socket.on("user-left-call", (data) => {
  const card = document.getElementById(`p-card-${data.user}`);
  if (card) card.remove();

  if (peerConnections[data.user]) {
    peerConnections[data.user].close();
    delete peerConnections[data.user];
  }
});

function filterInviteUsers() {
  const query = document.getElementById("search-call-users").value.toLowerCase().trim();

  // Se não houver busca, mostra todos os usuários online salvos no cache
  if (!query) {
    renderInviteUsersList(localOnlineUsersCache);
    return;
  }

  // Filtra a lista baseado no que foi digitado
  const filtered = localOnlineUsersCache.filter(user =>
    user.username.toLowerCase().includes(query)
  );

  renderInviteUsersList(filtered);
}

// Função acionada ao clicar em "Atender" ✅
async function acceptIncomingCall() {
  if (!incomingCallData) return;

  // 1. Emite o sinal de aceite de volta para o servidor conectar a malha Mesh WebRTC
  socket.emit("call-response-signal", {
    caller: incomingCallData.caller,
    responder: currentUser,
    accepted: true,
    room: incomingCallData.room,
    type: incomingCallData.type
  });

  // 2. Oculta o modal de convite da tela
  document.getElementById("incoming-call-modal").style.display = "none";

  // 3. Sincroniza o estado da chamada localmente
  currentCallRoom = incomingCallData.room;
  currentCallType = incomingCallData.type;

  // 4. Ativa o fluxo de captura de áudio/vídeo e entra na sala da chamada
  // (Usa a função padrão do seu sistema para abrir a webcam/microfone)
  if (typeof startCallStream === "function") {
    startCallStream(incomingCallData.room, incomingCallData.type);
  }

  // Limpa o cache do convite atendido
  incomingCallData = null;
}

// Função acionada ao clicar em "Recusar" ❌
function declineIncomingCall() {
  if (!incomingCallData) return;

  // 1. Avisa o servidor que a chamada foi rejeitada
  socket.emit("call-response-signal", {
    caller: incomingCallData.caller,
    responder: currentUser,
    accepted: false,
    room: incomingCallData.room
  });

  // 2. Esconde o modal da tela
  document.getElementById("incoming-call-modal").style.display = "none";

  // Limpa o cache
  incomingCallData = null;
}

function sendCallInvite() {
  console.log("[CLIENT - EMISSOR] Botão de iniciar chamada foi clicado.");

  if (selectedInviteUsers.size === 0) {
    alert("Por favor, selecione ao menos um usuário!");
    return;
  }

  const callRoomId = `call_${Date.now()}_${currentUser}`;
  currentCallRoom = callRoomId;

  const payload = {
    caller: currentUser,
    targets: Array.from(selectedInviteUsers),
    room: callRoomId,
    callType: "video"
  };

  console.log("[CLIENT - EMISSOR] Enviando o seguinte payload ao servidor:", payload);
  socket.emit("call-invite-payload", payload);
}

// Ouvir o convite de chamada recebido do servidor
// Ouve o sinal do servidor para abrir a janela de chamada recebida
// Ouvir o convite de chamada recebido do servidor
socket.on("incoming-call", (data) => {
  console.log("===> [SOCKET] EVENTO INCOMING-CALL RECEBIDO!", data);

  // Guarda os dados na variável global
  incomingCallData = data;

  // Atualiza os textos internos
  const callTitleElem = document.getElementById("incoming-call-title");
  const callTextElem = document.getElementById("incoming-call-text");

  if (callTitleElem) callTitleElem.textContent = "Chamada a Receber...";
  if (callTextElem) {
    callTextElem.textContent = `${data.caller} está a convidar-te para uma chamada.`;
  }

  // Torna o modal visível alterando a propriedade diretamente
  const modal = document.getElementById("incoming-call-modal");
  if (modal) {
    modal.style.setProperty("display", "flex", "important");
    console.log("[JS CLIENT] Sucesso: Forçou 'display: flex' no modal.");
  } else {
    console.error("[JS CLIENT] Erro: Não encontrou o elemento 'incoming-call-modal' no HTML.");
  }
});

socket.on("call-error-fallback", (data) => {
  console.log("[CLIENT] Falha ao completar chamada:", data.message);
  alert(data.message);

  // Se você tiver um overlay de "Ligando...", esconda-o aqui
  const activeCallOverlay = document.getElementById("active-call-overlay");
  if (activeCallOverlay) {
    activeCallOverlay.style.display = "none";
  }
});
