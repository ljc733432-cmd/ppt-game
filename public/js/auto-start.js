// Auto-start monitor: ONLY for Agent-host rooms (?watch=1&agents=N)
// Pure human rooms will NEVER auto-start.
(function() {
  // Only activate when this browser is the Agent host AND agents are expected
  if (!window.isAgentHost || !window.expectedAgentCount || window.expectedAgentCount <= 0) {
    console.log('[Auto] Normal mode — manual start required');
    return;
  }

  var agentJoined = 0;
  var autoStartFired = false;

  function setup() {
    var w = window.ws;
    if (!w || !w.onmessage) {
      setTimeout(setup, 500);
      return;
    }

    var orig = w.onmessage;
    w.onmessage = function(e) {
      orig.call(w, e);
      if (autoStartFired) return;

      try {
        var m = JSON.parse(e.data);

        // Count agent joins via agentJoined or playerList with isAgent
        if (m.type === 'agentJoined') {
          agentJoined++;
          console.log('[Auto] Agent ' + agentJoined + '/' + window.expectedAgentCount + ' joined: ' + m.name);
          checkAndStart(w);
        }

        // Also check playerList for agents that connected before auto-start.js loaded
        if (m.type === 'playerList') {
          var all = (m.players || []).concat(m.bots || []);
          var agentCount = 0;
          for (var i = 0; i < all.length; i++) {
            if (all[i].isAgent && !all[i].isBot) agentCount++;
          }
          if (agentCount > agentJoined) {
            agentJoined = agentCount;
            console.log('[Auto] Found ' + agentJoined + ' agent(s) already in room');
          }
          checkAndStart(w);
        }
      } catch(ex) {}
    };

    console.log('[Auto] Agent mode — waiting for ' + window.expectedAgentCount + ' agent(s)...');
  }

  function checkAndStart(w) {
    if (agentJoined < window.expectedAgentCount) return;
    if (autoStartFired) return;
    autoStartFired = true;

    console.log('[Auto] All ' + window.expectedAgentCount + ' agents joined! Filling bots and starting...');

    // Fill remaining slots with bots (max 4 players total)
    // Room already has: host (1) + agents (agentJoined) = host+agents
    // Fill to 4 with bots
    var totalPlayers = 1 + agentJoined;
    var botsToAdd = Math.max(0, 4 - totalPlayers);

    function addBotAndNext(idx) {
      if (idx >= botsToAdd) {
        // All bots added, start game
        setTimeout(function() {
          w.send(JSON.stringify({type:'setReady', ready:true}));
          setTimeout(function() {
            w.send(JSON.stringify({type:'startGame'}));
            console.log('[Auto] Game started!');
          }, 400);
        }, 300);
        return;
      }
      w.send(JSON.stringify({type:'addBot', difficulty:'medium'}));
      setTimeout(function() { addBotAndNext(idx + 1); }, 200);
    }

    addBotAndNext(0);
  }

  setup();
})();
