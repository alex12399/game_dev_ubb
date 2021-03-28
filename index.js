import express from 'express';
import http from 'http';
import io from 'socket.io';
import mongojs from 'mongojs';

const db = mongojs('localhost:27017/myGame', ['account', 'progress']);

const app = express();
const server = http.Server(app);

app.get('/', (req, res) => {
    res.sendFile(`${__dirname}/client/index.html`);
});

app.use('/client', express.static(`${__dirname}/client`));

server.listen(2000);
// eslint-disable-next-line no-console
console.log('Server started!');

const socketio = io(server, {});
const SOCKET_LIST = [];

const initPack = { players: [], bullets: [] };
const removePack = { players: [], bullets: [] };

const Entity = () => {
    const self = {
        x: 250,
        y: 250,
        spdX: 0,
        spdY: 0,
        id: '',
    };
    self.update = () => {
        self.updatePosition();
    };
    self.updatePosition = () => {
        self.x += self.spdX;
        self.y += self.spdY;
    };
    self.getDistance = (point) => Math.sqrt((self.x - point.x) ** 2 + (self.y - point.y) ** 2);

    return self;
};

const Bullet = (parent, angle) => {
    const self = Entity();
    self.id = Math.random();
    self.spdX = Math.cos((angle / 180) * Math.PI) * 10;
    self.spdY = Math.sin((angle / 180) * Math.PI) * 10;
    self.timer = 0;
    self.parent = parent;

    const superUpdate = self.update;
    self.update = () => {
        if (self.timer > 50) {
            removePack.bullets.push(self);
            delete Bullet.list[Bullet.list.indexOf(self)];
        }
        Bullet.list = Bullet.list.filter(Boolean);
        self.timer += 1;
        superUpdate();

        // eslint-disable-next-line no-use-before-define
        Player.list.forEach((player) => {
            if (self.getDistance(player) < 32 && self.parent !== player.id) {
                delete Bullet.list[Bullet.list.indexOf(self)];
                removePack.bullets.push(self);
            }
            Bullet.list = Bullet.list.filter(Boolean);
        });
    };
    Bullet.list.push(self);
    initPack.bullets.push({
        id: self.id,
        x: self.x,
        y: self.y,
    });
    return self;
};
Bullet.list = [];
Bullet.update = () => {
    const pack = [];
    Bullet.list.forEach(async (bullet) => {
        bullet.update();
        pack.push({
            id: bullet.id,
            x: bullet.x,
            y: bullet.y,
        });
    });
    return pack;
};

const Player = (playerId) => {
    const self = Entity();
    self.id = playerId;
    self.number = Math.floor(10 * Math.random());
    self.pressingRight = false;
    self.pressingLeft = false;
    self.pressingUp = false;
    self.pressingDown = false;
    self.pressingAttack = false;
    self.mouseAngle = 0;
    self.maxSpd = 10;

    const superUpdate = self.update;
    self.update = () => {
        self.updateSpd();
        superUpdate();

        if (self.pressingAttack) {
            self.shootBullet(self.mouseAngle);
        }
    };

    self.shootBullet = (angle) => {
        const bullet = Bullet(self.id, angle);
        bullet.x = self.x;
        bullet.y = self.y;
    };

    self.updateSpd = () => {
        if (self.pressingRight) self.spdX = self.maxSpd;
        else if (self.pressingLeft) self.spdX = -self.maxSpd;
        else self.spdX = 0;

        if (self.pressingUp) self.spdY = -self.maxSpd;
        else if (self.pressingDown) self.spdY = self.maxSpd;
        else self.spdY = 0;
    };
    Player.list.push(self);

    initPack.players.push({
        id: self.id,
        x: self.x,
        y: self.y,
        number: self.number,
    });
    return self;
};
Player.list = [];
Player.onConnect = (socket) => {
    const player = Player(socket.id);

    socket.on('keyPress', async (data) => {
        if (data.inputId === 'left') player.pressingLeft = data.state;
        else if (data.inputId === 'right') player.pressingRight = data.state;
        else if (data.inputId === 'up') player.pressingUp = data.state;
        else if (data.inputId === 'down') player.pressingDown = data.state;
        else if (data.inputId === 'attack') player.pressingAttack = data.state;
        else if (data.inputId === 'mouseAngle') player.mouseAngle = data.state;
    });
};
Player.onDisconnect = (socket) => {
    Player.list.forEach(async (player) => {
        if (player.id === socket.id) {
            delete Player.list[Player.list.indexOf(player)];
            removePack.players.push(player);
        }
    });
};
Player.update = () => {
    const pack = [];
    Player.list.forEach(async (player) => {
        player.update();
        pack.push({
            id: player.id,
            x: player.x,
            y: player.y,
        });
    });
    return pack;
};

const isValidPassword = async (data, cb) => {
    await db.account.find({ username: data.username, password: data.password }, async (err, res) => {
        if (res.length > 0) await cb(true);
        else await cb(false);
    });
};

const isUsernameTaken = async (data, cb) => {
    await db.account.find({ username: data.username }, async (err, res) => {
        if (res.length > 0) await cb(true);
        else await cb(false);
    });
};

const addUser = async (data, cb) => {
    await db.account.insert({ username: data.username, password: data.password }, async () => {
        await cb();
    });
};

socketio.sockets.on('connection', async (socket) => {
    socket.id = Math.random();
    SOCKET_LIST.push(socket);

    socket.on('signIn', async (data) => {
        await isValidPassword(data, async (res) => {
            if (res) {
                Player.onConnect(socket);
                socket.emit('signInResponse', { success: true });
            } else {
                socket.emit('signInResponse', { success: false });
            }
        });
    });

    socket.on('signUp', async (data) => {
        await isUsernameTaken(data, async (res) => {
            if (res) {
                socket.emit('signUpResponse', { success: false });
            } else {
                await addUser(data, async () => {
                    socket.emit('signUpResponse', { success: true });
                });
            }
        });
    });

    socket.on('disconnect', async () => {
        delete SOCKET_LIST[SOCKET_LIST.indexOf(socket)];
        Player.onDisconnect(socket);
    });

    socket.on('sendMsgToServer', async (data) => {
        const playerName = socket.id;
        SOCKET_LIST.forEach(async (s) => {
            s.emit('addToChat', `${playerName}: ${data}`);
        });
    });
});

setInterval(async () => {
    const pack = {
        players: Player.update(),
        bullets: Bullet.update(),
    };

    SOCKET_LIST.forEach(async (socket) => {
        socket.emit('init', initPack);
        socket.emit('update', pack);
        socket.emit('remove', removePack);
    });

    initPack.players = [];
    initPack.bullets = [];
    removePack.players = [];
    removePack.bullets = [];
}, 1000 / 25);
