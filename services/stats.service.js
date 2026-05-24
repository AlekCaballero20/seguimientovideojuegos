export function buildStats(data) {
  const gamesById = new Map(data.games.map((g) => [g.id, g]));
  const consolesById = new Map(data.consoles.map((c) => [c.id, c]));
  const now = Date.now();
  const weekAgo = now - (7 * 86400000);
  const monthAgo = now - (30 * 86400000);

  const totalMinutes = data.sessions.reduce((sum, s) => sum + (Number(s.duration) || 0), 0);
  const weekMinutes = data.sessions.filter((s) => s.playedAt >= weekAgo).reduce((sum, s) => sum + (Number(s.duration) || 0), 0);
  const monthMinutes = data.sessions.filter((s) => s.playedAt >= monthAgo).reduce((sum, s) => sum + (Number(s.duration) || 0), 0);

  const byCategory = {};
  const byConsole = {};
  const byGame = {};

  for (const session of data.sessions) {
    const game = gamesById.get(session.gameId);
    const consoleItem = consolesById.get(session.consoleId);
    const category = session.categoryAtPlay || game?.category || "secondary";
    const consoleName = consoleItem?.name || "Sin consola";
    const gameTitle = game?.title || "Juego borrado";
    const minutes = Number(session.duration) || 0;
    byCategory[category] = (byCategory[category] || 0) + minutes;
    byConsole[consoleName] = (byConsole[consoleName] || 0) + minutes;
    byGame[gameTitle] = (byGame[gameTitle] || 0) + minutes;
  }

  const completedCount = data.games.filter((g) => g.category === "completed").length;
  const curiositySessions = data.sessions.filter((s) => (s.categoryAtPlay || gamesById.get(s.gameId)?.category) === "curiosity");
  const curiosityMinutes = curiositySessions.reduce((sum, s) => sum + (Number(s.duration) || 0), 0);
  const curiosityGames = new Set(curiositySessions.map((s) => s.gameId));

  const repeatedCuriosity = data.games
    .filter((g) => g.category === "curiosity" && (g.sessionsCount || 0) >= 2)
    .sort((a, b) => (b.totalMinutes || 0) - (a.totalMinutes || 0));

  const topGames = Object.entries(byGame).sort((a, b) => b[1] - a[1]).slice(0, 8);

  return {
    totalMinutes,
    weekMinutes,
    monthMinutes,
    completedCount,
    byCategory,
    byConsole,
    byGame,
    topGames,
    curiosity: {
      sessions: curiositySessions.length,
      minutes: curiosityMinutes,
      games: curiosityGames.size,
      repeated: repeatedCuriosity
    }
  };
}
