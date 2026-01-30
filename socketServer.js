const crypto = require("crypto");

const createSocketServer = (io, { getAvatarUrl } = {}) => {
  // In-memory room store (max 2 players: host + guest).
  const rooms = new Map();

  const generateRoomId = () => {
    let roomId = "";
    while (!roomId || rooms.has(roomId)) {
      roomId = crypto.randomBytes(3).toString("hex");
    }
    return roomId;
  };

  const getRoomSnapshot = (roomId) => {
    const room = rooms.get(roomId);
    if (!room) return null;
    return {
      roomId,
      hostId: room.hostId,
      guestId: room.guestId,
      createdAt: room.createdAt,
    };
  };

  const buildProfile = (socket) => {
    const user = socket.data && socket.data.user ? socket.data.user : null;
    if (!user) return null;
    const name = [user.first_name, user.last_name].filter(Boolean).join(" ");
    return {
      id: user.id || socket.id,
      name: name || user.username || "Player",
      username: user.username || "",
      avatar: user.photo_url || "",
      socketId: socket.id,
    };
  };

  const requestAvatar = (socket, roomId, role) => {
    if (!getAvatarUrl) return;
    const user = socket.data && socket.data.user ? socket.data.user : null;
    if (!user || !user.id) return;
    if (user.photo_url) return;
    getAvatarUrl(user.id)
      .then((url) => {
        if (!url) return;
        const room = rooms.get(roomId);
        if (!room) return;
        const key = role === "host" ? "hostUser" : "guestUser";
        if (!room[key]) return;
        if (room[key].avatar) return;
        room[key].avatar = url;
        emitRoomUpdate(roomId);
      })
      .catch(() => {});
  };

  const emitRoomUpdate = (roomId) => {
    // Broadcast current room state to all members.
    const room = rooms.get(roomId);
    if (!room) return;
    io.to(roomId).emit("room_update", {
      roomId,
      host: room.hostUser || null,
      guest: room.guestUser || null,
      removedTargets: room.removedTargets ? Array.from(room.removedTargets) : [],
    });
  };

  const leaveRoom = (socket) => {
    const { roomId, role } = socket.data || {};
    if (!roomId) return;
    const room = rooms.get(roomId);
    if (!room) {
      socket.data.roomId = null;
      socket.data.role = null;
      return;
    }

    if (role === "host") {
      rooms.delete(roomId);
      socket.to(roomId).emit("room_closed", { roomId });
    } else if (role === "guest") {
      room.guestId = null;
      room.guestUser = null;
      socket.to(roomId).emit("peer_left", { roomId });
      emitRoomUpdate(roomId);
    }

    socket.leave(roomId);
    socket.data.roomId = null;
    socket.data.role = null;
  };

  io.on("connection", (socket) => {
    // Minimal user binding (ignored if Telegram auth already set).
    socket.on("set_user", (payload) => {
      if (socket.data.telegram && socket.data.telegram.ok) return;
      const user = payload && payload.user ? payload.user : null;
      socket.data.user = user;
      const { roomId, role } = socket.data || {};
      if (roomId && rooms.has(roomId)) {
        const room = rooms.get(roomId);
        if (role === "host") {
          room.hostUser = buildProfile(socket);
        } else if (role === "guest") {
          room.guestUser = buildProfile(socket);
        }
        emitRoomUpdate(roomId);
        requestAvatar(socket, roomId, role);
      }
    });

    socket.on("create_room", (payload, cb) => {
      const roomId = generateRoomId();
      const hostUser = buildProfile(socket);
      rooms.set(roomId, {
        hostId: socket.id,
        guestId: null,
        hostUser,
        guestUser: null,
        removedTargets: new Set(),
        createdAt: Date.now(),
      });
      socket.join(roomId);
      socket.data.roomId = roomId;
      socket.data.role = "host";

      const response = {
        ok: true,
        roomId,
        role: "host",
        host: hostUser,
        guest: null,
        removedTargets: [],
      };
      socket.emit("room_created", response);
      emitRoomUpdate(roomId);
      requestAvatar(socket, roomId, "host");
      if (typeof cb === "function") cb(response);
    });

    socket.on("join_room", (payload, cb) => {
      const roomId = payload && payload.roomId ? String(payload.roomId) : "";
      if (!roomId || !rooms.has(roomId)) {
        const response = { ok: false, code: "not_found", roomId };
        socket.emit("room_error", response);
        if (typeof cb === "function") cb(response);
        return;
      }

      const room = rooms.get(roomId);
      if (room.guestId && room.guestId !== socket.id) {
        const response = { ok: false, code: "full", roomId };
        socket.emit("room_error", response);
        if (typeof cb === "function") cb(response);
        return;
      }

      room.guestId = socket.id;
      room.guestUser = buildProfile(socket);
      socket.join(roomId);
      socket.data.roomId = roomId;
      socket.data.role = "guest";

      const response = {
        ok: true,
        roomId,
        role: "guest",
        host: room.hostUser || null,
        guest: room.guestUser || null,
        removedTargets: room.removedTargets ? Array.from(room.removedTargets) : [],
      };
      socket.emit("room_joined", response);
      socket
        .to(roomId)
        .emit("peer_joined", { roomId, guestId: socket.id, guest: room.guestUser || null });
      emitRoomUpdate(roomId);
      requestAvatar(socket, roomId, "guest");
      if (typeof cb === "function") cb(response);
    });

    socket.on("leave_room", () => {
      leaveRoom(socket);
    });

    socket.on("signal", (payload) => {
      const roomId =
        payload && payload.roomId ? payload.roomId : socket.data.roomId;
      if (!roomId) return;
      const data = payload && payload.data ? payload.data : null;
      if (data && data.type === "hit" && data.targetId) {
        const room = rooms.get(roomId);
        if (room) {
          if (!room.removedTargets) room.removedTargets = new Set();
          room.removedTargets.add(String(data.targetId));
        }
      }
      io.to(roomId).emit("signal", {
        roomId,
        from: socket.id,
        data,
      });
    });

    socket.on("get_room_state", (payload, cb) => {
      const roomId =
        payload && payload.roomId ? payload.roomId : socket.data.roomId;
      const snapshot = getRoomSnapshot(roomId);
      const room = rooms.get(roomId);
      const response = snapshot
        ? {
            ok: true,
            ...snapshot,
            host: room ? room.hostUser || null : null,
            guest: room ? room.guestUser || null : null,
            removedTargets:
              room && room.removedTargets ? Array.from(room.removedTargets) : [],
          }
        : { ok: false, roomId };
      if (typeof cb === "function") cb(response);
    });

    socket.on("disconnect", () => {
      leaveRoom(socket);
    });
  });
};

module.exports = { createSocketServer };
