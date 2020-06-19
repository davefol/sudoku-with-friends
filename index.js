var express = require('express');
var path = require('path');
var app = express();
var http = require('http').createServer(app);
var io = require('socket.io')(http);
var crypto = require("crypto");
var compression = require('compression');
var helmet = require('helmet');

var port = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));
app.use(helmet());
app.use(compression()); //Compress all routes

app.get('/', (req, res) => {
	res.sendFile(__dirname + '/index.html');
});

app.get('/room/:room_id', (req, res) => {
	res.sendFile(__dirname + '/index.html');
});


var ROOMS = new Map();
var PLAYER_ROOMS = new Map();
var PLAYER_COLORS = ["#e74c3c", "#f1c40f", "#9b59b6", "#3498db", "#1abc9c"];

function Player(id, color, room) {
	this.id = id;
	this.color = color;
	this.currently_selected = {x: 0, y: 0};
	this.room = room;
	PLAYER_ROOMS.set(id, room);
}

function Board(sdk_str, id) {
	this.id = id;
	this.players = [];
	this.available_colors = Array.from(PLAYER_COLORS);
	this.cells = [];
	for (let x = 0; x < 9; x++) {
		this.cells.push([]);
		for (let y = 0; y < 9; y++) {
			let cell = {
				x: x,
				y: y,
				candidates: [],
			};
			this.cells[x].push(cell);
		}
	} 
	let sanitized = sdk_str.replace(/[^\d.-]/g, '');
	if (sanitized.length != 81) {
		this.cells = null;
		return;
	}
	for (let i = 0; i < 81; i++) {
		let x = Math.floor(i / 9);
		let y = Math.floor(i % 9);
		let digit = sanitized.charAt(i);
		if (digit == '.') {
			this.cells[x][y].digit = 0;
			this.cells[x][y].prefilled = false;
		} else {
			this.cells[x][y].digit = parseInt(digit);
			this.cells[x][y].prefilled = true;
		}
	}
}

Board.prototype.addPlayer = function(id) {
	if (this.players.length < 5) {
		this.players.push(new Player(id, this.available_colors.pop(), this.id));
		return true;
	} else {
		return false;
	}

}

Board.prototype.removePlayer = function(id) {
	console.log("removing player")
	for (let i = 0; i < this.players.length; i++) {
		if (this.players[i].id == id) {
			this.available_colors.push(this.players[i].color);
			this.players.splice(i, 1);
			break;
		}
	}
}

io.on('connection', (socket) => {
	socket.emit("your id is", socket.id);
	socket.on('create new room', sdk => {
		Object.keys(socket.rooms).forEach(room => {
			if (room != socket.id) {
				socket.leave(room);
			}
		});
		let id = crypto.randomBytes(20).toString('hex');
		socket.join(id);
		let board = new Board(sdk, id);
		board.addPlayer(socket.id);
		if (board.cells) {
			ROOMS.set(id, board);
			socket.emit('set up board', ROOMS.get(id));
		} else {
			socket.emit('cant parse sdk');
		}
	});

	socket.on('join room', id => {
		if (PLAYER_ROOMS.get(socket.id)) {
			ROOMS.get(PLAYER_ROOMS.get(socket.id)).removePlayer(socket.id);
			PLAYER_ROOMS.delete(socket.id);
		}
		Object.keys(socket.rooms).forEach(room => {
			if (room != socket.id) {
				socket.leave(room);
			}
		});
		if (ROOMS.has(id)) {
			if (ROOMS.get(id).addPlayer(socket.id)) {
				socket.join(id);
				socket.emit('set up board', ROOMS.get(id));
			} else {
				socket.emit('room is full');
			}
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
		try {
			let board = ROOMS.get(room_id);
			let cell = board.cells[data.x][data.y];
			if (typeof data.digit != 'undefined') {
				cell.digit = data.digit;
			} 
			if (typeof data.modify_candidate != 'undefined') {
				if (data.modify_candidate.remove) {
					for (let i = 0; i < cell.candidates.length; i++) {
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
		} catch (e) {
			console.log(`Error in room ${room_id}: ${e}.`);
			socket.broadcast.to(room_id).emit("room no longer available");
		}
	});

	socket.on('show selected', (data) => {
		let room_id = PLAYER_ROOMS.get(socket.id);
		if (room_id) {
			let color = '';
			for (let player of ROOMS.get(room_id).players) {
				if (player.id == socket.id) {
					color = player.color;
					player.currently_selected = data.pos;
				}
			}
			socket.broadcast.to(room_id).emit('show selected', {
				pos: data.pos,
				color: color
			});
		}
	});

	socket.on('disconnect', function() {
		let room_id = PLAYER_ROOMS.get(socket.id);
		if (room_id) {
			ROOMS.get(room_id).removePlayer(socket.id);
			PLAYER_ROOMS.delete(socket.id);

			if (ROOMS.get(room_id).players.length == 0) {
				setTimeout(function() {
					if (ROOMS.get(room_id).players.length == 0)
						ROOMS.delete(room_id);
				}, 60 * 5);
			}
		}
	});
});

http.listen(port, () => {
});

