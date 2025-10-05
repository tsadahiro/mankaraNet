import { useRef, useState, useCallback } from 'react'
import { Button, Stack, TextField } from '@mui/material'
import {nowInSec, uuidV4, SkyWayStreamFactory, SkyWayContext, SkyWayRoom, SkyWayAuthToken, LocalDataStream } from '@skyway-sdk/room';

type Player = {
  id: any;
  nickname: string;
}

type GameState = {
  cells: number[][]; // ボードの状態
  turn: number; // 0 or 1 手番
  started: bool;
  players: Player[];
}

const token = new SkyWayAuthToken({
  jti: uuidV4(),
  iat: nowInSec(),
  exp: nowInSec() + 60 * 60 * 24,
  version: 3,
  scope: {
    appId: "c9b7bc82-5d20-433a-9c68-50845f184aae",
    rooms: [
      {
        name: "*",
        methods: ["create", "close", "updateMetadata"],
        member: {
          name: "*",
          methods: ["publish", "subscribe", "updateMetadata"],
        },
      },
    ],
  },
}).encode("ctnY2UtA3GH7K5/4LS3BMg6VdHGfK0YJfcO2IJIiZQ8=");


function App() {
  const scale = 100;
  const [gameState, setGameState] = useState<GameState>(init());
  const [roomName, setRoomName] = useState<any>("");
  const [nickname, setNickname] = useState<any>("");
  const [me, setMe] = useState<any>(null);
  const [imhost, setImhost] = useState<any>(false);
  const [dataStream, setDataStream] = useState<any>(null);
  const roomRef = useRef<any>(null);

  function init(){
    //const cells = [[3,3,3,3,3,3,0],[3,3,3,3,3,3,0]];
    //const cells = [[1,1,1,1,1,1,0],[1,1,1,1,1,1,0]];
    const cells = [[3,3,3,0],[3,3,3,0]];
    return {cells:cells, turn:0, started:false, players:[]};
  }

  function isMyTurn(){
    return (me.id === gameState.players[gameState.turn].id);
  }

  function f(r,j){
    if (!isMyTurn()) return;
    console.log(r,j);
    if (r != gameState.turn){
      return;
    }
    const x0 = gameState.cells[0].slice(0);
    const x1 = gameState.cells[1].slice(0);
    const x = [x0, x1];
    const N = x[0].length;
    const R = 2*N-1;
    const wrap = Math.floor(x[r][j]/R);
    console.log(wrap);
    
    function phi(k,i){
      const a = (i-j + N*Math.abs(k-gameState.turn)+R)%R;
      const b = gameState.cells[r][j]%R;
      console.log("("+k+","+i+")",a, b, a<=b, gameState.turn);
      if (i == N-1 && k != gameState.turn){ // point of the player not at turn does not change
	return gameState.cells[k][i];
      }
      else if (i == j && k == gameState.turn){ // the cell clicked is once cleared
	return wrap;
      }
      else if (a <= b){
	console.log("here");
	return x[k][i] + wrap + 1;
      }else{
	return x[k][i] + wrap;
      }
    }
    
    for (let k = 0; k < 2; k++){
      for (let i = 0; i < x[0].length; i++){
	x[k][i] = phi(k,i);
      }
    }

    let sum0 = 0;
    for (let v of x[r]) sum0+=v;
    let sum1 = 0;
    for (let v of x[(r+1)%2]) sum1+=v;
    const newturn = (sum0 == 0)? (gameState.turn)%2 : (gameState.turn + 1)%2
    const newstate = {cells:x, turn:newturn, players:gameState.players, started:gameState.started};
    setGameState(newstate);
    dataStream?.write(JSON.stringify({newstate:newstate}));
  }


  function Cell({i,j,num}){
    const N = gameState.cells[0].length;
    const y = (j==(N-1))? (scale/2) : ((i==0)? scale:0);
    const x =  (i==0)? (scale*(j+1)) : (scale*(N-1-j)); 
    const transform = "translate("+x+","+y+")"
    return(
      <g transform={transform} onClick={()=>f(i,j)}>
        <rect width={scale} height={scale} fill="khaki" stroke="white"/>
        <circle cy={scale/2} cx={scale/2} r={scale/2.5} fill={(gameState.turn==i && j!=(N-1)) ?"pink":"white"}/>
        <text y={scale*3/5} x={scale/3} fontSize={scale/2}>{num}</text>
      </g>
    )
  }


  function Turn(){
    if (!gameState.started) return;
    if (isMyTurn()){
      return <h3>あなたの手番</h3>;
    }
    else{
      return <h3>{gameState.players[gameState.turn].nickname}さんの手番</h3>;
    }
  }

  
  function Board(){
    if (!gameState.started) return;
    const cells = [[],[]];
    const N = gameState.cells[0].length;
    for (let i=0; i<2; i++){
      for (let j=0; j<N; j++){
        cells[i][j]=<Cell i={i} j={j} num={gameState.cells[i][j]}/>
      }
    }
    return(
    <svg width={(N+1)*scale} height={2*scale}>
      {cells}
    </svg>)
  }

  const join = useCallback(async (nickname, roomName) => {
    const context = await SkyWayContext.Create(token);

    // ルームを取得、または新規作成
    const room = await SkyWayRoom.FindOrCreate(context, {
      type: 'p2p',
      name: roomName,
    });
    roomRef.current = room;

    const me = await room.join({metadata:nickname});
    setMe(me);
    
    if (room.members.length === 1){
      // I am the host
      setImhost(true);
      setGameState({players:gameState.players,
		    turn:gameState.turn,
		    started:gameState.started,
		    cells:[[3,3,3,0],[3,3,3,0]],
      });
    }
    
    const data = await SkyWayStreamFactory.createDataStream();
    await me.publish(data);
    await setDataStream(data);

    room.publications.forEach(async (p) => {
      // 自分のは subscribe しない
      if (p.publisher.id === me.id) return;
      if (p.contentType !== "data") return;
      // すでに subscribe 済みならスキップ
      const already = me.subscriptions.some(sub => sub.publication.id === p.id);
      if (!already) {
	      const sub = await me.subscribe(p);
	// @ts-ignore
	sub.stream.onData.add((d:any)=>{
	  const mesg = JSON.parse(d);
	  console.log("newdata",mesg.newstate);
	  if (mesg.newstate !== null) {
	    setGameState(mesg.newstate);
	  }
	});
      }
    });

    room.onMemberJoined.add((_e) => {
      if (imhost){
	const newstate = {players:gameState.players,
			  turn:gameState.turn,
			  cells:gameState.cells,
			  started:gameState.started,
	};
	setGameState(newstate);
	data.write(JSON.stringify({newstate:newstate}));
	console.log(newstate);
      }
    });
    // その後に参加してきた人の情報を取得
    room.onStreamPublished.add(async (e) => {
      if (e.publication.publisher.id !== me.id && e.publication.contentType === "data") {
	console.log(e.publication.publisher.id, me.id);
	const sub = await me.subscribe(e.publication);
	// @ts-ignore
	sub.stream.onData?.add((d:any)=>{
	  const mesg = JSON.parse(d);
	  console.log(mesg.newstate);
	  if (mesg.newstate !== null) {
	    setGameState(mesg.newstate);
	  }
	});
      }
    });
  },[token])

  function start(){
    const players = roomRef.current.members.map((m:any) => ({
      id: m.id,
      nickname: m.metadata,
    }));
    console.log(players);
    const status = {cells:gameState.cells,
		    players: players,
		    turn:gameState.turn,
		    started:true,
    }
    setGameState(status);
    dataStream?.write(JSON.stringify({newstate:status}));
  }
  
  function StartButton(){
    if (gameState.started || !imhost) return;
    return <Button onClick={start}> Start </Button>;
  }
  
  return(
    <>
      <Stack >
	<Stack> <Turn/> </Stack>
	{ me === null ?
	<Stack direction="row">
	  <Button variant="contained" onClick={()=>join(nickname, roomName)}>join</Button>
	  <TextField   id="roomname" value={roomName} label="room name" variant="outlined"
		       onChange={(e)=>{setRoomName(e.target.value)}}/>
	  <TextField   id="nickname" value={nickname} label="nickname" variant="outlined"
		       onChange={(e)=>{setNickname(e.target.value)}}/>
	</Stack>
	:<></>
	}
	<StartButton />
	<Stack>
	  <Board/>
	</Stack>
      </Stack>
    </>
  )
}

export default App
