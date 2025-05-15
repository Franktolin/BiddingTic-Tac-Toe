const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// 提供静态文件
app.use(express.static(path.join(__dirname)));

// 玩家数据管理
const players = {};

// 游戏房间管理
const rooms = {};

// 可选的底分类型
const baseBidOptions = [10, 100, 1000, 10000];

// 生成六位随机房间代码
function generateRoomCode() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

// 获取可以公开的房间信息用于大厅展示
function getPublicRoomInfo() {
    const publicRooms = [];
    
    for (const roomCode in rooms) {
        const room = rooms[roomCode];
        // 确保玩家计数与实际状态一致
        const actualPlayerCount = (room.playerX ? 1 : 0) + (room.playerO ? 1 : 0);
        
        // 如果房间中没有玩家，或者只有一个玩家且对手已离开状态持续，则删除房间
        if (actualPlayerCount === 0 || (actualPlayerCount === 1 && room.opponentLeft)) {
            console.log(`清理空房间或对手已离开的房间: ${roomCode}`);
            delete rooms[roomCode];
            continue;
        }
        
        // 确保players数组与实际状态一致
        if (actualPlayerCount !== room.players.length) {
            console.log(`房间${roomCode}的玩家计数不一致，修正中: 实际${actualPlayerCount}，数组${room.players.length}`);
            room.players = [];
            if (room.playerX) room.players.push(room.playerX);
            if (room.playerO) room.players.push(room.playerO);
        }
        
        publicRooms.push({
            roomCode,
            playerCount: actualPlayerCount,
            spectatorCount: room.spectators ? room.spectators.length : 0,
            gameInProgress: room.playerX && room.playerO && !room.gameOver,
            roomName: room.roomName,
            baseBid: room.baseBid,
            gameState: {
                currentPlayer: room.currentPlayer,
                biddingPhase: room.biddingPhase,
                gameOver: room.gameOver,
                winner: room.winner
            }
        });
    }
    
    return publicRooms;
}

io.on('connection', (socket) => {
    console.log('用户已连接:', socket.id);
    
    // 设置昵称和初始化玩家数据
    socket.on('setNickname', (nickname) => {
        // 验证昵称
        if (!nickname || nickname.trim() === '') {
            socket.emit('error', { message: '昵称不能为空' });
            return;
        }
        
        // 初始化玩家数据
        players[socket.id] = {
            nickname: nickname,
            points: 100, // 初始积分
            id: socket.id
        };
        
        socket.emit('nicknameSet', {
            nickname: nickname,
            points: players[socket.id].points
        });
        
        console.log(`玩家 ${socket.id} 设置昵称为: ${nickname}`);
    });
    
    // 获取玩家信息
    socket.on('getPlayerInfo', () => {
        if (players[socket.id]) {
            socket.emit('playerInfo', players[socket.id]);
        } else {
            socket.emit('needNickname');
        }
    });
    
    // 创建新游戏房间
    socket.on('createRoom', ({ baseBid }) => {
        // 验证玩家已设置昵称
        if (!players[socket.id]) {
            socket.emit('needNickname');
            return;
        }
        
        // 验证底分
        if (!baseBidOptions.includes(baseBid)) {
            socket.emit('error', { message: '无效的底分选项' });
            return;
        }
        
        // 验证玩家积分是否足够
        if (players[socket.id].points < baseBid) {
            socket.emit('error', { message: `积分不足，需要至少 ${baseBid} 积分创建此类型房间` });
            return;
        }
        const roomCode = generateRoomCode();
        
        // 将用户加入房间
        socket.join(roomCode);
        
        // 初始化房间数据
        rooms[roomCode] = {
            players: [socket.id],
            spectators: [],             // 观战者列表
            board: Array(9).fill(''),
            currentPlayer: 'X',
            playerX: socket.id,
            playerO: null,
            playerXName: players[socket.id].nickname,
            playerOName: null,
            playerXPoints: players[socket.id].points,
            playerOPoints: 0,
            biddingPhase: true,
            bidWinner: null,
            lastBids: { X: null, O: null },
            totalBids: { X: 0, O: 0 },   // 跟踪整局总出价
            remainingBids: { X: baseBid, O: baseBid }, // 跟踪剩余可出价积分（与房间底分相同）
            gameOver: false,
            winner: null,
            roomName: `${players[socket.id].nickname}的房间`, // 房间名称
            baseBid: baseBid,              // 底分
            opponentLeft: false            // 对手是否已离开标志
        };
        
        console.log(`创建房间: ${roomCode}, 底分: ${baseBid}, 初始积分 - X: ${players[socket.id].points}, O: 0`);
        
        socket.emit('roomCreated', { roomCode, playerType: 'X' });
        console.log(`房间已创建: ${roomCode}, 玩家 X: ${socket.id}`);
        
        // 广播房间列表更新
        io.emit('roomListUpdated', getPublicRoomInfo());
    });
    
    // 加入现有房间
    socket.on('joinRoom', (roomCode) => {
        // 验证玩家已设置昵称
        if (!players[socket.id]) {
            socket.emit('needNickname');
            return;
        }
        // 验证房间存在
        if (!rooms[roomCode]) {
            socket.emit('error', { message: '房间不存在' });
            return;
        }
        
        // 验证房间是否已满
        if (rooms[roomCode].players.length >= 2) {
            socket.emit('error', { message: '房间已满' });
            return;
        }
        
        // 验证玩家积分是否足够
        if (players[socket.id].points < rooms[roomCode].baseBid) {
            socket.emit('error', { message: `积分不足，需要至少 ${rooms[roomCode].baseBid} 积分加入此房间` });
            return;
        }
        
        // 将玩家加入房间
        socket.join(roomCode);
        rooms[roomCode].players.push(socket.id);
        rooms[roomCode].playerO = socket.id;
        rooms[roomCode].playerOName = players[socket.id].nickname;
        rooms[roomCode].playerOPoints = players[socket.id].points;
        
        socket.emit('roomJoined', { roomCode, playerType: 'O' });
        
        // 通知房间所有玩家游戏开始
        io.to(roomCode).emit('gameState', rooms[roomCode]);
        console.log(`玩家 O 已加入房间 ${roomCode}: ${socket.id}`);
        
        // 广播房间列表更新
        io.emit('roomListUpdated', getPublicRoomInfo());
    });
    
    // 以观众身份加入房间
    socket.on('joinAsSpectator', (roomCode) => {
        // 验证玩家已设置昵称
        if (!players[socket.id]) {
            socket.emit('needNickname');
            return;
        }
        // 验证房间存在
        if (!rooms[roomCode]) {
            socket.emit('error', { message: '房间不存在' });
            return;
        }
        
        // 将观众加入房间
        socket.join(roomCode);
        
        // 初始化观众列表（如果不存在）
        if (!rooms[roomCode].spectators) {
            rooms[roomCode].spectators = [];
        }
        
        // 添加到观众列表
        rooms[roomCode].spectators.push(socket.id);
        
        // 发送当前游戏状态给观众
        socket.emit('spectatorJoined', {
            roomCode,
            gameState: rooms[roomCode]
        });
        
        console.log(`观众已加入房间 ${roomCode}: ${socket.id}`);
        
        // 向房间内所有人通知有新观众加入
        io.to(roomCode).emit('spectatorCountUpdated', rooms[roomCode].spectators.length);
        
        // 广播房间列表更新
        io.emit('roomListUpdated', getPublicRoomInfo());
    });
    
    // 获取房间列表
    socket.on('getRoomList', () => {
        socket.emit('roomList', getPublicRoomInfo());
    });
    
    // 提交出价
    socket.on('submitBid', ({ roomCode, playerType, bid }) => {
        // 验证玩家已设置昵称
        if (!players[socket.id]) {
            socket.emit('needNickname');
            return;
        }
        if (!rooms[roomCode]) return;
        
        const room = rooms[roomCode];
        
        // 检查是否已经提交过出价
        if (room.lastBids[playerType] !== null) {
            socket.emit('error', { message: `您已经提交过出价，请等待对方出价` });
            return;
        }
        
        console.log(`玩家${playerType}出价: ${bid}, 房间底分: ${room.baseBid}`);
        
        // 初始化总出价跟踪（如果不存在）
        if (!room.totalBids) {
            room.totalBids = { X: 0, O: 0 };
        }
        
        // 初始化剩余可出价积分（如果不存在）
        if (!room.remainingBids) {
            room.remainingBids = { X: 10, O: 10 };
        }
        
        // 初始化平局计数器（如果不存在）
        if (!room.tieCount) {
            room.tieCount = 0;
        }
        
        // 计算如果接受这个出价后的个人总出价
        const potentialPlayerTotalBid = (playerType === 'X') ?
            room.totalBids.X + bid :
            room.totalBids.O + bid;
            
        console.log(`当前总出价 - X: ${room.totalBids.X}, O: ${room.totalBids.O}`);
        console.log(`玩家${playerType}当前剩余可出价: ${room.remainingBids[playerType]}`);
        console.log(`如果接受此出价，玩家${playerType}总出价将为: ${potentialPlayerTotalBid}`);
        
        // 验证出价不超过底分
        if (bid > room.baseBid) {
            socket.emit('error', { message: `出价不能超过房间底分 ${room.baseBid}` });
            return;
        }
        
        // 验证出价至少为1
        if (bid < 1) {
            socket.emit('error', { message: `出价至少为1积分` });
            return;
        }
        
        // 验证个人总出价不超过房间底分
        if (potentialPlayerTotalBid > room.baseBid) {
            socket.emit('error', { message: `每位玩家整局所出积分不能超过房间底分${room.baseBid}，您当前已出: ${room.totalBids[playerType]}，剩余可出: ${room.remainingBids[playerType]}` });
            return;
        }
        
        // 更新出价信息（保密）
        room.lastBids[playerType] = bid;
        
        // 更新总出价跟踪
        if (playerType === 'X') {
            room.totalBids.X += bid;
            // 更新剩余可出价
            // 更新剩余可出价 - 适用于所有底分类型
            room.remainingBids.X = room.baseBid - room.totalBids.X;
        } else {
            room.totalBids.O += bid;
            // 更新剩余可出价
            // 更新剩余可出价 - 适用于所有底分类型
            room.remainingBids.O = room.baseBid - room.totalBids.O;
        }
        
        console.log(`更新后总出价 - X: ${room.totalBids.X}, O: ${room.totalBids.O}`);
        console.log(`更新后剩余可出价 - X: ${room.remainingBids.X}, O: ${room.remainingBids.O}`);
        
        // 如果两个玩家都已出价，确定赢家
        if (room.lastBids.X !== null && room.lastBids.O !== null) {
            if (room.lastBids.X > room.lastBids.O) {
                room.bidWinner = 'X';
                room.currentPlayer = 'X';
                room.tieCount = 0; // 重置平局计数
                room.biddingPhase = false; // 结束竞价阶段
            } else if (room.lastBids.O > room.lastBids.X) {
                room.bidWinner = 'O';
                room.currentPlayer = 'O';
                room.tieCount = 0; // 重置平局计数
                room.biddingPhase = false; // 结束竞价阶段
            } else {
                // 平局，增加平局计数
                room.tieCount++;
                console.log(`出价相同，平局次数: ${room.tieCount}`);
                
                if (room.tieCount >= 3) {
                    // 连续3次平局，判定为和局
                    console.log(`连续3次平局，判定为和局`);
                    room.gameOver = true;
                    room.biddingPhase = false;
                    
                    // 双方都损失出价的积分（已经在前面扣除了）
                    io.to(roomCode).emit('gameState', room);
                    return;
                } else {
                    // 未达到3次平局，重新进入竞价阶段
                    console.log(`未达到3次平局，重新进入竞价阶段`);
                    
                    // 保存当前出价用于返还
                    const xBid = room.lastBids.X;
                    const oBid = room.lastBids.O;
                    
                    // 重置出价
                    room.lastBids.X = null;
                    room.lastBids.O = null;
                    
                    // 保持竞价阶段
                    room.biddingPhase = true;
                    room.bidWinner = null;
                    
                    // 返回已扣除的积分
                    room.playerXPoints += xBid;
                    room.playerOPoints += oBid;
                    
                    console.log(`返还积分 - X: ${xBid}, O: ${oBid}`);
                    console.log(`当前积分 - X: ${room.playerXPoints}, O: ${room.playerOPoints}`);
                    
                    // 发送平局提示
                    io.to(roomCode).emit('error', { message: `双方出价相同，请重新出价！当前平局次数: ${room.tieCount}/3` });
                    io.to(roomCode).emit('gameState', room);
                    return;
                }
            }
            
            console.log(`竞价结果: 玩家X出价${room.lastBids.X}, 玩家O出价${room.lastBids.O}, 获胜者: ${room.bidWinner}`);
            
            // 扣除双方积分（确保双方都扣除）
            room.playerXPoints -= room.lastBids.X;
            room.playerOPoints -= room.lastBids.O;
            
            console.log(`扣除积分后 - 玩家X: ${room.playerXPoints}, 玩家O: ${room.playerOPoints}`);
            
            room.biddingPhase = false;
            io.to(roomCode).emit('gameState', room);
        } else {
            // 等待另一个玩家出价
            io.to(roomCode).emit('gameState', room);
        }
    });
    
    // 放置标记
    socket.on('placeMark', ({ roomCode, playerType, index }) => {
        if (!rooms[roomCode]) return;
        
        const room = rooms[roomCode];
        
        // 确保是当前玩家且位置未被占用
        if (room.currentPlayer !== playerType || room.board[index] !== '' || room.biddingPhase) {
            return;
        }
        
        // 放置标记
        room.board[index] = playerType;
        
        // 检查是否有赢家
        if (checkWinner(room.board)) {
            room.gameOver = true;
            room.winner = playerType;
            
            // 获胜者拿回自己的积分和对方输掉的积分
            if (playerType === 'X') {
                // X获胜
                console.log(`玩家X获胜，原积分: ${room.playerXPoints}`);
                console.log(`玩家X本局总出价: ${room.totalBids.X}, 玩家O本局总出价: ${room.totalBids.O}`);
                
                // 确保所有值都是数字
                const totalBidX = Number(room.totalBids.X) || 0;
                const totalBidO = Number(room.totalBids.O) || 0;
                
                // 获胜者拿回自己的积分和对方输掉的积分
                room.playerXPoints += (totalBidX + totalBidO);
                
                console.log(`玩家X新积分计算: ${room.playerXPoints - totalBidX - totalBidO} + ${totalBidX} (拿回自己积分) + ${totalBidO} (获得对方积分) = ${room.playerXPoints}`);
                console.log(`玩家X新积分: ${room.playerXPoints} (拿回自己本局总出价${totalBidX}并获得对方本局总出价${totalBidO})`);
            } else if (playerType === 'O') {
                // O获胜
                console.log(`玩家O获胜，原积分: ${room.playerOPoints}`);
                console.log(`玩家X本局总出价: ${room.totalBids.X}, 玩家O本局总出价: ${room.totalBids.O}`);
                
                // 确保所有值都是数字
                const totalBidX = Number(room.totalBids.X) || 0;
                const totalBidO = Number(room.totalBids.O) || 0;
                
                // 获胜者拿回自己的积分和对方输掉的积分
                room.playerOPoints += (totalBidX + totalBidO);
                
                console.log(`玩家O新积分计算: ${room.playerOPoints - totalBidX - totalBidO} + ${totalBidO} (拿回自己积分) + ${totalBidX} (获得对方积分) = ${room.playerOPoints}`);
                console.log(`玩家O新积分: ${room.playerOPoints} (拿回自己本局总出价${totalBidO}并获得对方本局总出价${totalBidX})`);
            }
            
            // 更新玩家数据中的积分
            if (room.playerX && players[room.playerX]) {
                players[room.playerX].points = room.playerXPoints;
            }
            if (room.playerO && players[room.playerO]) {
                players[room.playerO].points = room.playerOPoints;
            }
            
            io.to(roomCode).emit('gameState', room);
            return;
        }
        
        // 检查是否平局
        if (room.board.every(cell => cell !== '')) {
            room.gameOver = true;
            io.to(roomCode).emit('gameState', room);
            return;
        }
        
        // 重置竞价阶段
        room.biddingPhase = true;
        room.bidWinner = null;
        room.lastBids.X = null;
        room.lastBids.O = null;
        
        console.log(`回合结束，当前总出价 - X: ${room.totalBids.X}, O: ${room.totalBids.O}, 总计: ${room.totalBids.X + room.totalBids.O}`);
        
        // 检查是否有一方积分为0或剩余可出积分为0
        if (room.playerXPoints === 0 || room.playerOPoints === 0 ||
            (room.remainingBids.X === 0 || room.remainingBids.O === 0)) {
            // 有一方积分为0或剩余可出积分为0，检查是否已经有胜负
            if (checkWinner(room.board)) {
                // 已经有胜负，正常结算
                console.log(`已有胜负，正常结算`);
            } else {
                // 没有胜负，判定有积分的一方获胜
                console.log(`一方积分为0或剩余可出积分为0但没有胜负，判定有积分的一方获胜`);
                room.gameOver = true;
                
                // 判定获胜方
                if (room.playerXPoints === 0 || room.remainingBids.X === 0) {
                    room.winner = 'O';
                    console.log(`玩家X积分为0或剩余可出积分为0，判定玩家O获胜`);
                } else if (room.playerOPoints === 0 || room.remainingBids.O === 0) {
                    room.winner = 'X';
                    console.log(`玩家O积分为0或剩余可出积分为0，判定玩家X获胜`);
                }
                
                // 确保所有值都是数字
                const totalBidX = Number(room.totalBids.X) || 0;
                const totalBidO = Number(room.totalBids.O) || 0;
                
                // 获胜者获得所有出价积分
                if (room.winner === 'X') {
                    room.playerXPoints += (totalBidX + totalBidO);
                    console.log(`玩家X获胜，获得所有出价积分: ${totalBidX + totalBidO}`);
                    console.log(`玩家X新积分计算: ${room.playerXPoints - totalBidX - totalBidO} + ${totalBidX} (拿回自己积分) + ${totalBidO} (获得对方积分) = ${room.playerXPoints}`);
                } else if (room.winner === 'O') {
                    room.playerOPoints += (totalBidX + totalBidO);
                    console.log(`玩家O获胜，获得所有出价积分: ${totalBidX + totalBidO}`);
                    console.log(`玩家O新积分计算: ${room.playerOPoints - totalBidX - totalBidO} + ${totalBidO} (拿回自己积分) + ${totalBidX} (获得对方积分) = ${room.playerOPoints}`);
                }
                
                // 更新玩家数据中的积分
                if (room.playerX && players[room.playerX]) {
                    players[room.playerX].points = room.playerXPoints;
                }
                if (room.playerO && players[room.playerO]) {
                    players[room.playerO].points = room.playerOPoints;
                }
                
                io.to(roomCode).emit('gameState', room);
                return;
            }
        }
        
        // 如果两方都没有积分，游戏结束，平局
        if (room.playerXPoints === 0 && room.playerOPoints === 0) {
            room.gameOver = true;
        }
        
        io.to(roomCode).emit('gameState', room);
    });
    
    // 重置游戏
    socket.on('resetGame', (roomCode) => {
        if (!rooms[roomCode]) return;
        
        const room = rooms[roomCode];
        
        // 检查是否有两个玩家在房间中
        if (!room.playerX || !room.playerO) {
            socket.emit('error', { message: '对手已离开游戏，无法开始新游戏' });
            return;
        }
        
        // 保存当前积分
        const currentXPoints = room.playerXPoints;
        const currentOPoints = room.playerOPoints;
        
        rooms[roomCode] = {
            ...rooms[roomCode],
            board: Array(9).fill(''),
            currentPlayer: 'X',
            playerXPoints: currentXPoints, // 保持当前积分
            playerOPoints: currentOPoints, // 保持当前积分
            biddingPhase: true,
            bidWinner: null,
            lastBids: { X: null, O: null },
            totalBids: { X: 0, O: 0 },   // 重置总出价
            remainingBids: { X: rooms[roomCode].baseBid, O: rooms[roomCode].baseBid }, // 重置剩余可出价积分为当前底分
            tieCount: 0,                 // 重置平局计数器
            gamePool: 0,                 // 重置游戏池子
            gameOver: false,
            winner: null
        };
        
        console.log(`游戏重置: ${roomCode}, 保持当前积分 - X: ${currentXPoints}, O: ${currentOPoints}, 总出价重置为0, 剩余可出价重置为底分${rooms[roomCode].baseBid}`);
        
        // 向所有玩家和观众发送游戏状态
        io.to(roomCode).emit('gameState', rooms[roomCode]);
    });
    
    // 设置房间名称
    socket.on('setRoomName', ({ roomCode, roomName }) => {
        if (!rooms[roomCode]) return;
        
        // 验证是房主（玩家X）才能设置房间名
        if (rooms[roomCode].playerX !== socket.id) {
            socket.emit('error', { message: '只有房主可以设置房间名' });
            return;
        }
        
        rooms[roomCode].roomName = roomName;
        
        // 通知房间内所有人房间名更改
        io.to(roomCode).emit('roomNameUpdated', roomName);
        
        // 广播房间列表更新
        io.emit('roomListUpdated', getPublicRoomInfo());
    });
    
    // 离开房间
    socket.on('leaveRoom', (roomCode) => {
        if (!rooms[roomCode]) return;
        
        const room = rooms[roomCode];
        const gameInProgress = room.players.length === 2 && !room.gameOver;
        
        // 处理玩家离开
        if (room.playerX === socket.id) {
            if (gameInProgress && room.playerO) {
                // 游戏进行中房主离开，视为认输，对方获胜
                console.log(`游戏进行中房主(X)离开，视为认输，玩家O获胜`);
                
                // 设置对手为获胜者
                room.gameOver = true;
                room.winner = 'O';
                
                // 确保所有值都是数字
                const totalBidX = Number(room.totalBids.X) || 0;
                const totalBidO = Number(room.totalBids.O) || 0;
                
                // 获胜者获得所有出价积分
                room.playerOPoints += (totalBidX + totalBidO);
                
                console.log(`玩家O获胜，获得所有出价积分: ${totalBidX + totalBidO}`);
                console.log(`玩家O新积分: ${room.playerOPoints}`);
                
                // 更新玩家数据中的积分
                if (room.playerO && players[room.playerO]) {
                    players[room.playerO].points = room.playerOPoints;
                }
                
                // 通知房间内所有人游戏结束
                io.to(roomCode).emit('gameState', room);
                
                // 延迟删除房间，让客户端有时间显示结果
                setTimeout(() => {
                    if (rooms[roomCode]) {
                        delete rooms[roomCode];
                        console.log(`房主离开，房间已删除: ${roomCode}`);
                        io.emit('roomListUpdated', getPublicRoomInfo());
                    }
                }, 5000);
            } else {
                // 游戏未开始或已结束，正常删除房间
                socket.to(roomCode).emit('hostLeft');
                delete rooms[roomCode];
                console.log(`房主离开，房间已删除: ${roomCode}`);
                io.emit('roomListUpdated', getPublicRoomInfo());
            }
        }
        else if (room.playerO === socket.id) {
            if (gameInProgress) {
                // 游戏进行中玩家O离开，视为认输，对方获胜
                console.log(`游戏进行中玩家O离开，视为认输，玩家X获胜`);
                
                // 设置对手为获胜者
                room.gameOver = true;
                room.winner = 'X';
                
                // 确保所有值都是数字
                const totalBidX = Number(room.totalBids.X) || 0;
                const totalBidO = Number(room.totalBids.O) || 0;
                
                // 获胜者获得所有出价积分
                room.playerXPoints += (totalBidX + totalBidO);
                
                console.log(`玩家X获胜，获得所有出价积分: ${totalBidX + totalBidO}`);
                console.log(`玩家X新积分: ${room.playerXPoints}`);
                
                // 更新玩家数据中的积分
                if (room.playerX && players[room.playerX]) {
                    players[room.playerX].points = room.playerXPoints;
                }
                
                // 通知房间内所有人游戏结束
                io.to(roomCode).emit('gameState', {...room, opponentLeft: true});
                
                // 检查玩家X是否还在
                if (!room.playerX) {
                    // 如果玩家X也已经离开，销毁房间
                    console.log(`玩家X和玩家O都已离开，销毁房间: ${roomCode}`);
                    delete rooms[roomCode];
                } else {
                    // 玩家O离开，但保留房间
                    room.playerO = null;
                    room.players = room.players.filter(id => id !== socket.id);
                    
                    // 标记对手已离开
                    room.opponentLeft = true;
                    
                    // 通知房间内玩家
                    socket.to(roomCode).emit('opponentLeft');
                }
            } else {
                // 检查玩家X是否还在
                if (!room.playerX) {
                    // 如果玩家X也已经离开，销毁房间
                    console.log(`玩家X和玩家O都已离开，销毁房间: ${roomCode}`);
                    delete rooms[roomCode];
                } else {
                    // 游戏未开始或已结束，正常离开
                    room.playerO = null;
                    room.players = room.players.filter(id => id !== socket.id);
                    
                    // 确保游戏结束状态
                    room.gameOver = true;
                    
                    // 重置游戏状态
                    room.board = Array(9).fill('');
                    room.currentPlayer = 'X';
                    room.biddingPhase = true;
                    room.bidWinner = null;
                    room.lastBids = { X: null, O: null };
                    room.totalBids = { X: 0, O: 0 };  // 重置总出价
                    room.remainingBids = { X: 10, O: 10 }; // 重置剩余可出价积分
                    room.tieCount = 0;  // 重置平局计数器
                    
                    console.log(`玩家O离开，游戏状态已设为结束`);
                    
                    // 标记对手已离开
                    room.opponentLeft = true;
                    
                    // 发送更新的游戏状态，包含opponentLeft标志
                    io.to(roomCode).emit('gameState', {...room, opponentLeft: true});
                    
                    // 通知房间内玩家
                    socket.to(roomCode).emit('opponentLeft');
                }
            }
            
            // 广播房间列表更新
            io.emit('roomListUpdated', getPublicRoomInfo());
        }
        else {
            // 观众离开
            if (rooms[roomCode].spectators) {
                rooms[roomCode].spectators = rooms[roomCode].spectators.filter(id => id !== socket.id);
                
                // 通知房间内所有人观众数量更新
                io.to(roomCode).emit('spectatorCountUpdated', rooms[roomCode].spectators.length);
                
                // 广播房间列表更新
                io.emit('roomListUpdated', getPublicRoomInfo());
            }
        }
        
        // 离开房间频道
        socket.leave(roomCode);
    });
    
    // 认输
    socket.on('surrender', ({ roomCode, playerType }) => {
        if (!rooms[roomCode]) return;
        
        const room = rooms[roomCode];
        
        // 确认是当前玩家
        if ((playerType === 'X' && room.playerX !== socket.id) ||
            (playerType === 'O' && room.playerO !== socket.id)) {
            return;
        }
        
        // 保存当前积分（防止重置）
        const currentXPoints = room.playerXPoints;
        const currentOPoints = room.playerOPoints;
        
        // 设置对手为获胜者
        room.gameOver = true;
        room.winner = playerType === 'X' ? 'O' : 'X';
        
        // 获胜者拿回自己的积分和对方输掉的积分
        if (room.winner === 'X') {
            console.log(`认输: 玩家X获胜，原积分: ${room.playerXPoints}`);
            console.log(`玩家X本局总出价: ${room.totalBids.X}, 玩家O本局总出价: ${room.totalBids.O}`);
            
            // 确保所有值都是数字
            const totalBidX = Number(room.totalBids.X) || 0;
            const totalBidO = Number(room.totalBids.O) || 0;
            
            // 获胜者拿回自己的积分和对方输掉的积分
            room.playerXPoints += (totalBidX + totalBidO);
            
            console.log(`玩家X新积分计算: ${room.playerXPoints - totalBidX - totalBidO} + ${totalBidX} (拿回自己积分) + ${totalBidO} (获得对方积分) = ${room.playerXPoints}`);
            console.log(`玩家X新积分: ${room.playerXPoints} (拿回自己本局总出价${totalBidX}并获得对方本局总出价${totalBidO})`);
        } else if (room.winner === 'O') {
            console.log(`认输: 玩家O获胜，原积分: ${room.playerOPoints}`);
            console.log(`玩家X本局总出价: ${room.totalBids.X}, 玩家O本局总出价: ${room.totalBids.O}`);
            
            // 确保所有值都是数字
            const totalBidX = Number(room.totalBids.X) || 0;
            const totalBidO = Number(room.totalBids.O) || 0;
            
            // 获胜者拿回自己的积分和对方输掉的积分
            room.playerOPoints += (totalBidX + totalBidO);
            
            console.log(`玩家O新积分计算: ${room.playerOPoints - totalBidX - totalBidO} + ${totalBidO} (拿回自己积分) + ${totalBidX} (获得对方积分) = ${room.playerOPoints}`);
            console.log(`玩家O新积分: ${room.playerOPoints} (拿回自己本局总出价${totalBidO}并获得对方本局总出价${totalBidX})`);
        }
        
        // 更新玩家数据中的积分
        if (room.playerX && players[room.playerX]) {
            players[room.playerX].points = room.playerXPoints;
        }
        if (room.playerO && players[room.playerO]) {
            players[room.playerO].points = room.playerOPoints;
        }
        
        // 通知所有人游戏结束
        io.to(roomCode).emit('gameState', room);
    });
    
    // 处理断开连接
    socket.on('disconnect', () => {
        console.log('用户已断开连接:', socket.id);
        
        // 查找玩家所在的房间并清理
        for (const roomCode in rooms) {
            const room = rooms[roomCode];
            
            // 处理玩家断开连接
            if (room.playerX === socket.id) {
                // 房主断开连接，通知其他人
                socket.to(roomCode).emit('hostLeft');
                
                // 删除房间
                delete rooms[roomCode];
                console.log(`房主断开连接，房间已删除: ${roomCode}`);
                break;
            }
            else if (room.playerO === socket.id) {
                // 玩家O断开连接
                room.playerO = null;
                room.players = room.players.filter(id => id !== socket.id);
                
                // 重置游戏状态
                room.board = Array(9).fill('');
                room.currentPlayer = 'X';
                room.biddingPhase = true;
                room.bidWinner = null;
                room.lastBids = { X: null, O: null };
                room.gameOver = true;  // 改为true，表示游戏已结束
                room.winner = null;
                room.opponentLeft = true;  // 添加opponentLeft标志
                
                // 通知房间内玩家
                socket.to(roomCode).emit('opponentLeft');
                socket.to(roomCode).emit('gameState', {...room, opponentLeft: true});  // 发送更新的游戏状态
                break;
            }
            else if (room.spectators && room.spectators.includes(socket.id)) {
                // 观众断开连接
                room.spectators = room.spectators.filter(id => id !== socket.id);
                
                // 通知房间内所有人观众数量更新
                io.to(roomCode).emit('spectatorCountUpdated', room.spectators.length);
                break;
            }
        }
        
        // 广播房间列表更新
        io.emit('roomListUpdated', getPublicRoomInfo());
    });
});

// 检查是否有赢家的辅助函数
function checkWinner(board) {
    const winPatterns = [
        [0, 1, 2], [3, 4, 5], [6, 7, 8], // 横行
        [0, 3, 6], [1, 4, 7], [2, 5, 8], // 纵列
        [0, 4, 8], [2, 4, 6]             // 对角线
    ];
    
    return winPatterns.some(pattern => {
        const [a, b, c] = pattern;
        return board[a] && board[a] === board[b] && board[a] === board[c];
    });
}

// 定期保存玩家数据 (每分钟)
setInterval(() => {
    console.log('更新玩家积分数据');
    // 遍历所有房间，确保玩家数据与房间数据一致
    for (const roomCode in rooms) {
        const room = rooms[roomCode];
        
        if (room.playerX && players[room.playerX]) {
            players[room.playerX].points = room.playerXPoints;
        }
        if (room.playerO && players[room.playerO]) {
            players[room.playerO].points = room.playerOPoints;
        }
    }
}, 60000);

// 启动服务器
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`服务器运行在 http://localhost:${PORT}`);
});