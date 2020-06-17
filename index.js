var express = require('express');
var path = require('path');
var app = express();
var http = require('http').createServer(app);
var io = require('socket.io')(http);
var crypto = require("crypto");

app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
	res.sendFile(__dirname + '/index.html');
});

var ROOMS = new Map();
var DIFFICULTY = {
	easy: new Map(),
	medium: new Map(),
	hard: new Map(),
}

function Board(difficulty, id) {
	this.id = id;
	this.cells = [];
	for (let x = 0; x < 9; x++) {
		this.cells.push([]);
		for (let y = 0; y < 9; y++) {
			let cell = {
				x: x,
				y: y,
				candidates: [],
			};
			if (DIFFICULTY[difficulty].has({x: x, y: y})) {
				cell.filled = true;
				cell.digit = DIFFICULTY[difficulty].get({x: x, y: y});
			} else {
				cell.filled = false;
				cell.digit = 0;
			}
			this.cells[x].push(cell);
		}
	} 
}

io.on('connection', (socket) => {
  console.log('a user connected');
	socket.on('create new room', difficulty => {
		Object.keys(socket.rooms).forEach(room => {
			if (room != socket.id) {
				socket.leave(room);
			}
		});
		let id = crypto.randomBytes(20).toString('hex');
		socket.join(id);
		ROOMS.set(id, new Board(difficulty, id));
		socket.emit('set up board', ROOMS.get(id));
	});

	socket.on('join room', id => {
		Object.keys(socket.rooms).forEach(room => {
			if (room != socket.id) {
				socket.leave(room);
			}
		});
		if (ROOMS.has(id)) {
			socket.join(id);
			socket.emit('set up board', ROOMS.get(id));
		} else {
			socket.emit('room not found');
		}
	});

	socket.on('update cell', (data) => {
		let room_id = '';
		Object.keys(socket.rooms).forEach(room => {
			if (room != socket.id && typeof room == 'string') {
				room_id = room;
			}
		});
		let board = ROOMS.get(room_id);
		let cell = board.cells[data.x][data.y];
		if (typeof data.digit != 'undefined') {
			cell.digit = data.digit;
		} 
		if (typeof data.modify_candidate != 'undefined') {
			if (data.modify_candidate.remove) {
				for (let i = 0; i < cell.candidate.length; i++) {
					if (cell.candidates[i] == data.modify_candidate.candidate) {
						cell.candidates.splice(i, 1);
						break;
					}
				}
			} else {
				cell.candidates.push(data.modify_candidate.candidate);
			}
		}
		ROOMS.set(room_id, board);
		socket.broadcast.to(room_id).emit('update cell', data);
	});

	socket.on('disconnect', function() {
		let room_id = '';
		Object.keys(socket.rooms).forEach(room => {
			if (room != socket.id && typeof room == 'string') {
				room_id = room;
			}
		});

		if (io.sockets.clients(room_id).length == 0) {
			setTimeout(function() {
				if (io.sockets.clients(room_id).length == 0)
					ROOMS.delete(room_id);
			}, 60 * 5);
		}
	});
});

http.listen(3000, () => {
  console.log('listening on *:3000');
});

