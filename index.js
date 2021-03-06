import express from 'express';
import http from 'http';
import io from 'socket.io';
// import mongojs from 'mongojs';

// const db = mongojs('localhost:27017/myGame', ['account', 'progress']);

const app = express();
const server = http.Server(app);

app.get('/', (req, res) => {
    res.sendFile(`${__dirname}/client/index.html`);
});

app.use('/client', express.static(`${__dirname}/client`));

server.listen(process.env.PORT || 2000);
// eslint-disable-next-line no-console
console.log('Server started!');

const socketio = io(server, {});
const SOCKET_LIST = [];

const initPack = { players: [], bullets: [] };
const removePack = { players: [], bullets: [] };

const Entity = (param) => {
    const self = {
        x: 250,
        y: 250,
        spdX: 0,
        spdY: 0,
        id: '',
        map: 'forest',
    };
    if (param) {
        if (param.x) self.x = param.x;
        if (param.y) self.y = param.y;
        if (param.map) self.map = param.map;
        if (param.id) self.id = param.id;
    }
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

const Bullet = (param) => {
    const self = Entity(param);
    self.id = Math.random();
    self.spdX = Math.cos((param.angle / 180) * Math.PI) * 10;
    self.spdY = Math.sin((param.angle / 180) * Math.PI) * 10;
    self.timer = 0;
    self.parent = param.parent;
    self.angle = param.angle;

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
            if (self.map === player.map && self.getDistance(player) < 32 && self.parent !== player.id) {
                player.hp -= 1;
                if (player.hp <= 0) {
                    // eslint-disable-next-line no-use-before-define
                    const shooter = Player.list.find((p) => p.id === self.parent);
                    if (shooter) shooter.score += 1;
                    player.hp = player.hpMax;
                    player.x = Math.random() * 500;
                    player.y = Math.random() * 500;
                }
                delete Bullet.list[Bullet.list.indexOf(self)];
                removePack.bullets.push(self);
            }
            Bullet.list = Bullet.list.filter(Boolean);
        });
    };

    self.getInitPack = () => ({
        id: self.id,
        x: self.x,
        y: self.y,
        map: self.map,
    });

    self.getUpdatePack = () => ({
        id: self.id,
        x: self.x,
        y: self.y,
    });

    Bullet.list.push(self);
    initPack.bullets.push(self.getInitPack());

    return self;
};
Bullet.list = [];
Bullet.update = () => {
    const pack = [];
    Bullet.list.forEach(async (bullet) => {
        bullet.update();
        pack.push(bullet.getUpdatePack());
    });
    return pack;
};
Bullet.getAllinitPack = () => {
    const bullets = [];
    Bullet.list.forEach((bullet) => {
        bullets.push(bullet.getInitPack());
    });
    return bullets;
};

const Player = (param) => {
    const self = Entity(param);
    self.username = param.username;
    self.number = Math.floor(10 * Math.random());
    self.pressingRight = false;
    self.pressingLeft = false;
    self.pressingUp = false;
    self.pressingDown = false;
    self.pressingAttack = false;
    self.mouseAngle = 0;
    self.maxSpd = 10;
    self.hp = 10;
    self.hpMax = 10;
    self.score = 0;

    const superUpdate = self.update;
    self.update = () => {
        self.updateSpd();
        superUpdate();

        if (self.pressingAttack) {
            self.shootBullet(self.mouseAngle);
        }
    };

    self.shootBullet = (angle) => {
        Bullet({
            parent: self.id,
            angle,
            x: self.x,
            y: self.y,
            map: self.map,
        });
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

    self.getInitPack = () => ({
        id: self.id,
        x: self.x,
        y: self.y,
        number: self.number,
        hp: self.hp,
        hpMax: self.hpMax,
        score: self.score,
        map: self.map,
    });

    self.getUpdatePack = () => ({
        id: self.id,
        x: self.x,
        y: self.y,
        hp: self.hp,
        score: self.score,
        map: self.map,
    });

    initPack.players.push(self.getInitPack());
    return self;
};
Player.list = [];
Player.onConnect = (socket, username) => {
    let map = 'forest';
    if (Math.random() < 0.5) map = 'field';
    const player = Player({ username, id: socket.id, map });

    socket.on('keyPress', async (data) => {
        if (data.inputId === 'left') player.pressingLeft = data.state;
        else if (data.inputId === 'right') player.pressingRight = data.state;
        else if (data.inputId === 'up') player.pressingUp = data.state;
        else if (data.inputId === 'down') player.pressingDown = data.state;
        else if (data.inputId === 'attack') player.pressingAttack = data.state;
        else if (data.inputId === 'mouseAngle') player.mouseAngle = data.state;
    });

    socket.on('changeMap', async () => {
        if (player.map === 'field') player.map = 'forest';
        else player.map = 'field';
    });

    socket.on('sendMsgToServer', async (data) => {
        SOCKET_LIST.forEach(async (s) => {
            s.emit('addToChat', `${player.username}: ${data}`);
        });
    });

    socket.on('sendPmToServer', async (data) => {
        let recipientSocket = null;
        Player.list.forEach((p) => {
            if (p.username === data.username) {
                SOCKET_LIST.forEach((s) => {
                    if (s.id === p.id) recipientSocket = s;
                });
            }
        });
        if (recipientSocket === null) socket.emit('addToChat', `The player ${data.username} was not found`);
        else {
            recipientSocket.emit('addToChat', `From ${player.username}: ${data.message}`);
            socket.emit('addToChat', `To ${data.username}: ${data.message}`);
        }
    });

    const players = [];
    Player.list.forEach((p) => {
        if (p.id !== player.id) players.push(p.getInitPack());
    });

    socket.emit('init', {
        players,
        bullets: Bullet.getAllinitPack(),
        selfId: socket.id,
    });
};
Player.onDisconnect = (socket) => {
    Player.list.forEach(async (player) => {
        if (player.id === socket.id) {
            delete Player.list[Player.list.indexOf(player)];
            removePack.players.push(player);
        }
    });
    Player.list = Player.list.filter(Boolean);
};
Player.update = () => {
    const pack = [];
    Player.list.forEach(async (player) => {
        player.update();
        pack.push(player.getUpdatePack());
    });
    return pack;
};

const isValidPassword = async (data, cb) => {
    return cb(true);
    // await db.account.find({ username: data.username, password: data.password }, async (err, res) => {
    //     if (res.length > 0) await cb(true);
    //     else await cb(false);
    // });
};

const isUsernameTaken = async (data, cb) => {
    return cb(false);
    // await db.account.find({ username: data.username }, async (err, res) => {
    //     if (res.length > 0) await cb(true);
    //     else await cb(false);
    // });
};

const addUser = async (data, cb) => {
    return cb();
    // await db.account.insert({ username: data.username, password: data.password }, async () => {
    //     await cb();
    // });
};

socketio.sockets.on('connection', async (socket) => {
    socket.id = Math.random();
    SOCKET_LIST.push(socket);

    socket.on('signIn', async (data) => {
        await isValidPassword(data, async (res) => {
            if (res) {
                Player.onConnect(socket, data.username);
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
