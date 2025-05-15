const { createApp, ref, reactive, computed } = Vue;

createApp({
    setup() {
        // 用户数据
        const hasNickname = ref(false);
        const nickname = ref('');
        const nicknameInput = ref('');
        const userPoints = ref(0);
        
        // 剩余可出价积分
        const remainingBidsX = ref(10);
        const remainingBidsO = ref(10);
        
        // 平局计数
        const tieCount = ref(0);
        
        // 底分选择
        const baseBidOptions = ref([10, 100, 1000, 10000]);
        const selectedBaseBid = ref(null);
        const currentBaseBid = ref(0);
        
        // 游戏状态
        const inRoom = ref(false);
        const opponentJoined = ref(false);
        const roomCode = ref('');
        const roomCodeInput = ref('');
        const roomList = ref([]); // 房间列表
        const roomName = ref(''); // 当前房间名称
        const roomNameInput = ref(''); // 设置房间名称的输入
        const playerType = ref(''); // 'X' 或 'O'
        const isSpectator = ref(false); // 是否为观战者
        const spectatorCount = ref(0); // 观众数量
        const currentPlayer = ref('X');
        const board = ref(Array(9).fill(''));
        const playerXPoints = ref(100);
        const playerOPoints = ref(100);
        const playerXName = ref('');
        const playerOName = ref('');
        const biddingPhase = ref(true);
        const gameOver = ref(false);
        const winner = ref(null);
        const bidWinner = ref(null);
        const opponentLeft = ref(false);
        const hostLeft = ref(false); // 房主离开的标志
        const lastBidSubmitted = ref(false); // 标记玩家是否已出价
        
        // 竞价相关状态
        const playerXBid = ref(1);
        const playerOBid = ref(1);
        const lastBids = reactive({
            X: null,
            O: null
        });
        
        // 初始化Socket连接
        const socket = io();
        
        // Socket事件监听
        socket.on('connect', () => {
            console.log('连接到服务器');
            
            // 连接后检查是否有保存的昵称
            const savedNickname = localStorage.getItem('nickname');
            if (savedNickname) {
                nicknameInput.value = savedNickname;
                setNickname();
            } else {
                // 请求玩家信息
                socket.emit('getPlayerInfo');
            }
        });
        
        // 需要设置昵称
        socket.on('needNickname', () => {
            hasNickname.value = false;
        });
        
        // 昵称设置成功
        socket.on('nicknameSet', ({ nickname: name, points }) => {
            nickname.value = name;
            userPoints.value = points;
            hasNickname.value = true;
            localStorage.setItem('nickname', name);
        });
        
        // 接收玩家信息
        socket.on('playerInfo', (playerData) => {
            nickname.value = playerData.nickname;
            userPoints.value = playerData.points;
            hasNickname.value = true;
        });
        
        // 请求房间列表
        socket.emit('getRoomList');
        
        // 接收房间列表更新
        socket.on('roomList', (rooms) => {
            roomList.value = rooms;
            console.log('接收到房间列表:', rooms);
        });
        
        socket.on('roomListUpdated', (rooms) => {
            roomList.value = rooms;
            console.log('房间列表已更新:', rooms);
        });
        
        socket.on('roomCreated', ({ roomCode: code, playerType: type }) => {
            roomCode.value = code;
            playerType.value = type;
            inRoom.value = true;
            isSpectator.value = false;
            console.log(`创建房间成功: ${code}, 玩家类型: ${type}`);
        });
        
        socket.on('roomJoined', ({ roomCode: code, playerType: type }) => {
            roomCode.value = code;
            playerType.value = type;
            inRoom.value = true;
            isSpectator.value = false;
            opponentJoined.value = true;
            hostLeft.value = false;
            console.log(`加入房间成功: ${code}, 玩家类型: ${type}`);
        });
        
        socket.on('spectatorJoined', ({ roomCode: code, gameState }) => {
            roomCode.value = code;
            inRoom.value = true;
            isSpectator.value = true;
            playerType.value = '';
            opponentJoined.value = true;
            hostLeft.value = false;
            console.log(`以观众身份加入房间: ${code}`);
            
            // 更新游戏状态
            updateGameState(gameState);
        });
        
        // 游戏状态更新辅助函数
        const updateGameState = (state) => {
            // 对手已加入
            if (state.players.length > 1) {
                opponentJoined.value = true;
            } else if (state.players.length === 1 && opponentJoined.value) {
                // 如果之前有对手，现在只有一个玩家，说明对手离开了
                opponentLeft.value = true;
                opponentJoined.value = false;
            }
            
            // 更新对手离开状态
            if (state.opponentLeft !== undefined) {
                opponentLeft.value = state.opponentLeft;
            }
            
            // 如果有平局计数，保存它
            if (state.tieCount !== undefined) {
                tieCount.value = state.tieCount;
            }
            
            // 更新游戏状态
            board.value = [...state.board];
            currentPlayer.value = state.currentPlayer;
            playerXPoints.value = state.playerXPoints;
            playerOPoints.value = state.playerOPoints;
            biddingPhase.value = state.biddingPhase;
            bidWinner.value = state.bidWinner;
            gameOver.value = state.gameOver;
            winner.value = state.winner;
            
            // 更新剩余可出价积分
            if (state.remainingBids) {
                remainingBidsX.value = state.remainingBids.X;
                remainingBidsO.value = state.remainingBids.O;
            }
            
            // 更新玩家名称
            if (state.playerXName) {
                playerXName.value = state.playerXName;
            }
            if (state.playerOName) {
                playerOName.value = state.playerOName;
            }
            
            // 更新房间信息
            if (state.roomName) {
                roomName.value = state.roomName;
            }
            if (state.baseBid) {
                currentBaseBid.value = state.baseBid;
            }
            
            // 更新自己的积分
            if (playerType.value === 'X') {
                userPoints.value = playerXPoints.value;
            } else if (playerType.value === 'O') {
                userPoints.value = playerOPoints.value;
            }
        };
        
        socket.on('gameState', (state) => {
            console.log('收到游戏状态更新:', state);
            
            // 如果是平局重新出价，显示提示
            if (state.tieCount > 0 && state.biddingPhase && state.lastBids.X === null && state.lastBids.O === null) {
                console.log(`平局重新出价，当前平局次数: ${state.tieCount}/3`);
            }
            
            updateGameState(state);
            
            // 只有不在竞价阶段时才显示双方出价
            if (!state.biddingPhase) {
                lastBids.X = state.lastBids.X;
                lastBids.O = state.lastBids.O;
                lastBidSubmitted.value = false; // 重置出价状态
            } else if (state.biddingPhase) {
                // 竞价阶段，只能看到自己的出价
                if (playerType.value === 'X') {
                    lastBids.X = state.lastBids.X; // 只能看到自己的出价
                    lastBids.O = null; // 看不到对方的出价
                } else {
                    lastBids.O = state.lastBids.O; // 只能看到自己的出价
                    lastBids.X = null; // 看不到对方的出价
                }
            }
            
            // 重置当前玩家的出价输入（不超过底分，最小为1积分）
            if (playerType.value === 'X') {
                playerXBid.value = 1; // 默认设置为1
            } else {
                playerOBid.value = 1; // 默认设置为1
            }
            
            // 更新剩余可出价积分
            if (state.remainingBids) {
                remainingBidsX.value = state.remainingBids.X;
                remainingBidsO.value = state.remainingBids.O;
                console.log(`更新剩余可出价积分 - X: ${remainingBidsX.value}, O: ${remainingBidsO.value}`);
            }
        });
        
        socket.on('roomNameUpdated', (name) => {
            roomName.value = name;
        });
        
        socket.on('spectatorCountUpdated', (count) => {
            spectatorCount.value = count;
        });
        
        socket.on('error', ({ message }) => {
            alert(`错误: ${message}`);
        });
        
        socket.on('opponentLeft', () => {
            opponentLeft.value = true;
            opponentJoined.value = false;
        });
        
        socket.on('hostLeft', () => {
            hostLeft.value = true;
            opponentJoined.value = false;
        });
        
        // 设置昵称
        const setNickname = () => {
            if (!nicknameInput.value.trim()) {
                alert('请输入有效的昵称');
                return;
            }
            
            socket.emit('setNickname', nicknameInput.value);
        };
        
        // 选择底分
        const selectBaseBid = (bid) => {
            selectedBaseBid.value = bid;
        };
        
        // 刷新房间列表
        const refreshRoomList = () => {
            socket.emit('getRoomList');
        };
        
        // 创建房间
        const createRoom = () => {
            if (!selectedBaseBid.value) {
                alert('请选择房间底分');
                return;
            }
            
            socket.emit('createRoom', { baseBid: selectedBaseBid.value });
        };
        
        // 加入房间
        const joinRoom = (code) => {
            const roomId = code || roomCodeInput.value;
            
            if (!roomId || roomId.length !== 6) {
                alert('请输入有效的6位房间代码');
                return;
            }
            
            socket.emit('joinRoom', roomId);
        };
        
        // 以观众身份加入房间（观战）
        const spectateRoom = (code) => {
            const roomId = code || roomCodeInput.value;
            
            if (!roomId || roomId.length !== 6) {
                alert('请输入有效的6位房间代码');
                return;
            }
            
            socket.emit('joinAsSpectator', roomId);
        };
        
        // 设置房间名称
        const setRoomName = () => {
            if (!roomNameInput.value.trim()) {
                alert('请输入有效的房间名称');
                return;
            }
            
            socket.emit('setRoomName', {
                roomCode: roomCode.value,
                roomName: roomNameInput.value
            });
        };
        
        // 提交出价
        const submitBid = (player) => {
            let bidAmount = player === 'X' ? playerXBid.value : playerOBid.value;
            let maxPoints = player === 'X' ? playerXPoints.value : playerOPoints.value;
            let remainingBid = player === 'X' ? remainingBidsX.value : remainingBidsO.value;
            
            // 出价不能超过玩家积分、房间底分和剩余可出价积分
            let maxBid = Math.min(maxPoints, currentBaseBid.value, remainingBid);
            
// 调试信息
            console.log(`计算最大出价 - 玩家积分: ${maxPoints}, 房间底分: ${currentBaseBid.value}, 剩余可出价: ${remainingBid}, 最终maxBid: ${maxBid}`);
            if (bidAmount < 1 || bidAmount > maxBid) {
                alert(`无效的出价，请输入1到${maxBid}之间的数字`);
                return;
            }
            
            socket.emit('submitBid', {
                roomCode: roomCode.value,
                playerType: player,
                bid: bidAmount
            });
            
            lastBidSubmitted.value = true; // 标记已出价
        };
        
        // 放置标记
        const placeMark = (index) => {
            // 如果不是玩家的回合或者游戏结束或正在竞价阶段，不允许放置
            if (currentPlayer.value !== playerType.value || gameOver.value || biddingPhase.value) {
                return;
            }
            
            // 如果单元格已被占用，不允许放置
            if (board.value[index] !== '') {
                return;
            }
            
            socket.emit('placeMark', {
                roomCode: roomCode.value,
                playerType: playerType.value,
                index: index
            });
        };
        
        // 认输
        const surrender = () => {
            if (confirm('确定要认输吗？您将失去本局比赛。')) {
                socket.emit('surrender', {
                    roomCode: roomCode.value,
                    playerType: playerType.value
                });
            }
        };
        
        // 重置游戏
        const resetGame = () => {
            // 如果对手已离开或房主已离开，不允许重置游戏
            if (opponentLeft.value || hostLeft.value) {
                alert('对手已离开游戏，无法开始新游戏。请返回大厅重新匹配。');
                return;
            }
            socket.emit('resetGame', roomCode.value);
        };
        
        // 离开房间
        const leaveRoom = () => {
            // 如果游戏已经开始且不是观战者，则视为认输
            if (roomCode.value && opponentJoined.value && !gameOver.value && !isSpectator.value) {
                if (confirm('游戏正在进行中，离开将被视为认输，确定要离开吗？')) {
                    socket.emit('surrender', {
                        roomCode: roomCode.value,
                        playerType: playerType.value
                    });
                    // 等待一小段时间让服务器处理认输逻辑
                    setTimeout(() => {
                        socket.emit('leaveRoom', roomCode.value);
                    }, 500);
                } else {
                    return; // 取消离开
                }
            } else if (roomCode.value) {
                // 游戏未开始或已结束或是观战者，正常离开
                socket.emit('leaveRoom', roomCode.value);
            }
            
            // 重置所有状态
            inRoom.value = false;
            opponentJoined.value = false;
            roomCode.value = '';
            roomCodeInput.value = '';
            roomNameInput.value = '';
            roomName.value = '';
            playerType.value = '';
            currentPlayer.value = 'X';
            board.value = Array(9).fill('');
            playerXPoints.value = 100;
            playerOPoints.value = 100;
            playerXName.value = '';
            playerOName.value = '';
            biddingPhase.value = true;
            gameOver.value = false;
            winner.value = null;
            bidWinner.value = null;
            opponentLeft.value = false;
            hostLeft.value = false;
            isSpectator.value = false;
            spectatorCount.value = 0;
            lastBids.X = null;
            lastBids.O = null;
            playerXBid.value = 1;
            playerOBid.value = 1;
            lastBidSubmitted.value = false;
            selectedBaseBid.value = null;
            currentBaseBid.value = 0;
            
            // 重新获取房间列表
            refreshRoomList();
        };
        
        return {
            // 用户数据
            hasNickname,
            nickname,
            nicknameInput,
            userPoints,
            remainingBidsX,
            remainingBidsO,
            tieCount,
            
            // 底分选择
            baseBidOptions,
            selectedBaseBid,
            currentBaseBid,
            
            // 游戏状态
            inRoom,
            opponentJoined,
            roomCode,
            roomCodeInput,
            roomList,
            roomName,
            roomNameInput,
            playerType,
            isSpectator,
            spectatorCount,
            currentPlayer,
            board,
            playerXPoints,
            playerOPoints,
            playerXName,
            playerOName,
            biddingPhase,
            gameOver,
            winner,
            bidWinner,
            opponentLeft,
            hostLeft,
            lastBidSubmitted,
            
            // 竞价状态
            playerXBid,
            playerOBid,
            lastBids,
            
            // 方法
            setNickname,
            selectBaseBid,
            refreshRoomList,
            createRoom,
            joinRoom,
            spectateRoom,
            setRoomName,
            submitBid,
            placeMark,
            surrender,
            resetGame,
            leaveRoom
        };
    }
}).mount('#app');