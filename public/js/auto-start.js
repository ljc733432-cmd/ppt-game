// Auto-start monitor: detects Agent players and auto-starts the game
(function() {
  var spawned = false;
  var orig = ws.onmessage;
  ws.onmessage = function(e) {
    orig.call(ws, e);
    if (spawned) return;
    try {
      var m = JSON.parse(e.data);

      // Signal 1: agentJoined — server sends this when an Agent joins
      if (m.type === 'agentJoined') {
        console.log('[Auto] Agent detected via agentJoined:', m.name);
        trigger();
        return;
      }

      // Signal 2: playerList — check if any player is an agent
      if (m.type === 'playerList') {
        var all = (m.players || []).concat(m.bots || []);
        for (var i = 0; i < all.length; i++) {
          if (all[i].isAgent && !all[i].isBot) {
            console.log('[Auto] Agent detected via playerList:', all[i].name);
            trigger();
            return;
          }
        }
      }
    } catch(ex) {}
  };

  function trigger() {
    if (spawned) return;
    spawned = true;
    ws.send(JSON.stringify({type:'setReady',ready:true}));
    setTimeout(function() {
      ws.send(JSON.stringify({type:'startGame'}));
      console.log('[Auto] Game started!');
    }, 400);
  }

  console.log('[Auto] Monitor active — waiting for Agent...');
})();
