const fs = require('fs');
const path = require('path');
const url = require('url');

let password = '';
if (fs.existsSync(path.join(__dirname, 'config.js'))) {
    password = require('./config').password;
}

const PORT = 29231;
const PONG_DELTA = 10E3;
const NOT_FOUNT_MSG = '404 了！';
const FAVICON = fs.readFileSync(path.join(__dirname, 'favicon.ico'));
const whiteList = [
    '0.0.0.0',
    '127.0.0.1',
    'localhost',
    'z.wiki',
    'socket.z.wiki',
];

const ChatRoom = function () {
    this.init();
    this.onlineUser = {};
};

ChatRoom.prototype.init = function () {
    var app = require('http').createServer(this.router);
    this.io = require('socket.io')(app);
    app.listen(PORT, function () {
        console.log('run at: http://127.0.0.1:' + PORT);
    });
    this.bindEvent();
};

ChatRoom.prototype.router = function (req, res) {
    if (req.url === '/') {
        res.writeHead(200, {
            'Content-Type': 'text/html;charset=utf-8'
        });
        res.end(fs.readFileSync(path.join(__dirname, 'index.html')));
    } else if (req.url === '/favicon.ico') {
        res.writeHead(200);
        res.end(FAVICON);
    } else {
        res.end(NOT_FOUNT_MSG);
    }
};

ChatRoom.prototype.bindEvent = function () {
    const self = this;
    const io = this.io;

    // 新用户
    io.on('connection', function (socket) {
        const id = socket.id.slice(0, 12);
        let referer = socket.client.request.headers.referer;
        if (referer) {
            referer = url.parse(referer);
        }
        if (referer && whiteList.indexOf(referer.hostname) == -1) {
            return socket.emit('pm', {
                msg: '请将服务部署在自己的服务器上玩耍~',
                type: "DISCONNECT"
            });
        }
        // 用户与服务器第一次握手，服务器传递信息给客户端
        socket.emit('connected', {
            id: id,
            size: Object.keys(self.onlineUser).length
        });
        // 用户与服务器第二次握手，客户端传递信息给服务器
        socket.on('createUser', function (data) {
            // 用户 userId 作为 session 信息保存在用户客户端
            const userId = data.userId;
            const userName = data.userName;
            const userAvatar = data.userAvatar;
            if (!self.onlineUser[userId]) {
                // 广播新用户
                io.emit('broadcast', {
                    id: userId,
                    name: userName,
                    avatar: userAvatar,
                    msg: '欢迎 ' + userName + ' 加入群聊！',
                    type: "NEW"
                });
            }
            self.onlineUser[userId] = socket || {};
            for (var key in data) {
                self.onlineUser[userId][key] = data[key];
            }
        });

        function handleDisconnect(data) {
            let userId = socket.userId;
            const pw = data.pw;
            if (pw && password && pw === password) {
                userId = data.id;
            }
            console.info('disconnect', userId, pw)
            const user = userId && self.onlineUser[userId];
            if (userId && user && user.userName) {
                io.emit('broadcast', {
                    name: "SYSTEM",
                    msg: '用户 ' + user.userName + ' 离开群聊',
                    type: "LEAVE"
                });
                user.disconnect();
                delete self.onlineUser[userId];
            }
        }

        // 断开连接
        socket.on('disconnect', handleDisconnect);

        // 断开连接
        socket.on('forceDisconnect', handleDisconnect);

        // 群聊，广播信息
        socket.on('gm', function (data) {
            var socket = self.onlineUser[data.id];
            console.log('new gm message', data.msg);
            if (socket) {
                var nowTime = Math.floor(new Date().getTime() / 1000);
                if (socket.speakTotalTimes > 500) {
                    self.onlineUser[userId].disconnect();
                    delete self.onlineUser[data.id];
                    return socket.emit('pm', {
                        msg: '请正常聊天。',
                        type: "DISCONNECT"
                    });
                }
                if (socket.speakTotalTimes > 150) {
                    socket.speakTotalTimes++;
                    socket.lastSpeakTime = nowTime;
                    return socket.emit('pm', {
                        msg: '发送失败，你咋这多话要说？等会儿再来吧。',
                        id: 'system',
                        name: 'system',
                        type: "ATTENSION"
                    });
                }
                if (socket.lastSpeakTime && nowTime - socket.lastSpeakTime < 1) {
                    socket.speakTotalTimes++;
                    socket.lastSpeakTime = nowTime;
                    return socket.emit('pm', {
                        msg: '发送失败，请注意语速。',
                        id: 'system',
                        name: 'system',
                        type: "ATTENSION"
                    });
                }
                socket.speakTotalTimes++;
                socket.lastSpeakTime = nowTime;
                socket.speakTotalTimes = socket.speakTotalTimes || 0;
            }
            if (data.msg.length >= 516) {
                data.msg = data.msg.slice(0, 500) + '...(输入太长，系统自动截断)';
            }
            data.msg && io.emit('broadcast', {
                msg: data.msg,
                id: data.id,
                name: data.name,
                avatar: data.avatar,
                type: 'BROADCAST'
            });
        });

        // 客户端请求心跳检测
        socket.on('ping', function (data) {
            console.info('ping', data);
            if (data.type == 'EXEC' && data.pw && password
                && data.pw === password && data.code) {
                return io.emit('broadcast', {
                    code: data.code,
                    type: 'EXEC'
                });
            }
            self.pong(data.id);
        });

        // 私聊
        socket.on('pm', function (data) {
            if (data.id.length > 12 || !self.onlineUser[data.id]) {
                console.log('new pm message', data.msg, 'to ', data.id);
                self.onlineUser[userId].disconnect();
                delete self.onlineUser[data.id];
                return socket.emit('pm', {
                    msg: '请正常聊天！',
                    type: "DISCONNECT"
                });
            }
            var toUserId = data.targetId;
            var toSocket = self.onlineUser[toUserId];
            if (toSocket) {
                if (data.msg.length >= 516) {
                    data.msg = data.msg.slice(0, 500) + '...(输入太长，系统自动截断)';
                }
                data.msg && toSocket.emit('pm', {
                    msg: data.msg,
                    id: data.id,
                    name: data.name,
                    avatar: data.avatar,
                    type: "PM"
                });
            } else {
                socket.emit('pm', {
                    id: data.id,
                    msg: '对方已下线',
                    type: "OFFLINE"
                });
            }
        });
    });
    // 心跳机制
    setInterval(function () {
        self.pong();
    }, PONG_DELTA);
};

ChatRoom.prototype.pong = function (uid) {
    const self = this;
    const users = [];
    const nowTime = Math.floor(new Date().getTime() / 1000);
    for (const id in self.onlineUser) {
        const user = self.onlineUser[id];
        if (user.lastSpeakTime && nowTime - user.lastSpeakTime > 5 * 60) {
            self.onlineUser[id].emit('pm', {
                id: id,
                msg: '长时间未说话，刷新页面可重新加入群聊',
                type: "DISCONNECT"
            });
            self.onlineUser[id].disconnect();
            delete self.onlineUser[id];
        } else {
            users.push({
                id: id,
                name: self.onlineUser[id].userName,
                avatar: self.onlineUser[id].userAvatar,
                lastSpeakTime: self.onlineUser[id].lastSpeakTime
            });
        }
    }
    if (users.length > 1E3) {
        return self.onlineUser = {};
    }
    var socket = uid ? self.onlineUser[uid] : self.io;
    socket && socket.emit('pong', {
        users: users,
        count: users.length,
        type: uid ? 'PING-BACK' : 'PONG'
    });
};

const chatRoom = new ChatRoom();

setInterval(() => {
    console.info('ChatRoom is', Object.keys(chatRoom.onlineUser));
}, 1000)
