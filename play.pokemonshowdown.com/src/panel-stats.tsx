/**
 * Relumi Battle Stats Panel
 *
 * Displays detailed battle statistics, player leaderboards,
 * Pokemon usage, and meta trends. Appears in the right panel.
 *
 * @license MIT
 */

import { PS, PSRoom, type RoomOptions } from "./client-main";
import { PSPanelWrapper, PSRoomPanel, PSIcon } from "./panels";
import preact from "../js/lib/preact";

const API_URL = '/api/battlestats';

/** Formats tracked by the battle stats system. */
const FORMATS = [
	{ id: 'gen8relumisinglesrandom', label: '[Gen 8] Relumi Random Singles' },
	{ id: 'gen8relumidoublesrandom', label: '[Gen 8] Relumi Random Doubles' },
	{ id: 'gen8relumisinglesanythinggoes', label: '[Gen 8] Relumi Singles Anything Goes' },
	{ id: 'gen8relumisinglesubers', label: '[Gen 8] Relumi Singles Ubers' },
	{ id: 'gen8relumisinglesou', label: '[Gen 8] Relumi Singles OU' },
	{ id: 'gen8relumidoublesanythinggoes', label: '[Gen 8] Relumi Doubles Anything Goes' },
	{ id: 'gen8relumidoublesubers', label: '[Gen 8] Relumi Doubles Ubers' },
	{ id: 'gen8relumidoublesou', label: '[Gen 8] Relumi Doubles OU' },
	{ id: 'all', label: 'All Formats' },
];

// ---- Room ----

export class StatsRoom extends PSRoom {
	override readonly classType: string = 'battlestats';
	constructor(options: RoomOptions) {
		super(options);
	}
}

// ---- Constants ----

// Short stat labels for the team export helper (matches Showdown's teambuilder format).
const STAT_SHORT_NAMES: Record<string, string> = {
	hp: 'HP', atk: 'Atk', def: 'Def', spa: 'SpA', spd: 'SpD', spe: 'Spe',
};

// ---- Types ----

type LeaderboardTab = 'topByBattles' | 'topByWinRate' | 'topByCurrentWinStreak';
type DetailTab = 'detail' | 'trends';

interface SpeciesTrendData {
	species: string;
	days: Array<{ date: string; usagePct: number; winRate: number }>;
}

interface StatsState {
	format: string;
	range: string;
	loading: boolean;
	error: string | null;
	data: any | null; // BattleStatsApiResponse
	leaderboardTab: LeaderboardTab;
	sortCol: string;
	sortAsc: boolean;
	expandedSpecies: string | null;
	expandedTab: DetailTab;
	trendsLoading: boolean;
	trendsError: string | null;
	trendsData: SpeciesTrendData | null;
	randomTeamLoading: boolean;
	randomTeam: any[] | null;
	copyNotice: string | null;
	searchQuery: string;
	showPersonal: boolean;
}

// ---- Helpers ----

/**
 * Builds canonical Showdown-importable text for a team. Used by both the
 * "Top Teams" export buttons and the "Random team" button so the format
 * stays consistent. Strips empty EV/IV/nature fields so imported teams
 * remain legal in the teambuilder.
 */
function generateTeamExportText(team: any[]): string {
	return team.map((mon: any) => {
		const lines: string[] = [];
		const item = mon.item || '';
		lines.push(item ? `${mon.species} @ ${item}` : `${mon.species}`);
		if (mon.ability) lines.push(`Ability: ${mon.ability}`);
		const evs: string[] = [];
		for (const stat of Object.keys(STAT_SHORT_NAMES)) {
			const v = mon.evs?.[stat];
			if (v && v > 0) evs.push(`${v} ${STAT_SHORT_NAMES[stat]}`);
		}
		if (evs.length) lines.push(`EVs: ${evs.join(' / ')}`);
		if (mon.nature) lines.push(`${mon.nature} Nature`);
		const ivs: string[] = [];
		for (const stat of Object.keys(STAT_SHORT_NAMES)) {
			const v = mon.ivs?.[stat];
			if (v !== undefined && v !== 31) ivs.push(`${v} ${STAT_SHORT_NAMES[stat]}`);
		}
		if (ivs.length) lines.push(`IVs: ${ivs.join(' / ')}`);
		for (const move of mon.moves || []) {
			if (move) lines.push(`- ${move}`);
		}
		return lines.join('\n');
	}).join('\n\n');
}

// ---- Panel ----

class StatsPanel extends PSRoomPanel<StatsRoom> {
	static readonly id = 'battlestats';
	static readonly routes = ['battlestats'];
	static readonly Model = StatsRoom;
	static readonly location = 'right';
	static readonly title = 'Battle Stats';
	static readonly icon = <i class="fa fa-bar-chart" aria-hidden></i>;

	override state: StatsState = {
		format: FORMATS[0].id,
		range: 'all',
		loading: true,
		error: null,
		data: null,
		leaderboardTab: 'topByBattles',
		sortCol: 'usagePct',
		sortAsc: false,
		expandedSpecies: null,
		expandedTab: 'detail',
		trendsLoading: false,
		trendsError: null,
		trendsData: null,
		randomTeamLoading: false,
		randomTeam: null,
		copyNotice: null,
		searchQuery: '',
		showPersonal: false,
	};

	override componentDidMount() {
		super.componentDidMount();
		this.fetchData();
	}

	fetchData = async () => {
		this.setState({ loading: true, error: null, searchQuery: '' });
		try {
			const { format, range, showPersonal } = this.state;
			let url = `${API_URL}?format=${encodeURIComponent(format)}&range=${encodeURIComponent(range)}`;
			// Append user filter when personal stats toggle is on
			if (showPersonal && PS.user.userid) {
				url += `&user=${encodeURIComponent(PS.user.userid)}`;
			}
			const res = await fetch(url);
			if (!res.ok) {
				// Try to parse error body for more detail
				let detail = '';
				try { const errBody = await res.json(); detail = errBody.error || ''; } catch {}
				throw new Error(detail || `Server returned ${res.status}${res.status === 502 ? ' (game server unavailable)' : ''}`);
			}
			// Verify we got JSON before parsing
			const contentType = res.headers.get('content-type') || '';
			if (!contentType.includes('application/json')) {
				throw new Error(
					'Stats API returned non-JSON response. ' +
					'Make sure the game server is running on port 8000.'
				);
			}
			const data = await res.json();
			this.setState({ data, loading: false });
		} catch (err: any) {
			this.setState({ error: err.message || 'Unknown error', loading: false });
		}
	};

	handleChangeFormat = (ev: Event) => {
		this.setState({ format: (ev.currentTarget as HTMLSelectElement).value }, this.fetchData);
	};

	handleChangeRange = (ev: Event) => {
		this.setState({ range: (ev.currentTarget as HTMLSelectElement).value }, this.fetchData);
	};

	setTab = (tab: LeaderboardTab) => this.setState({ leaderboardTab: tab });

	setSort = (col: string) => {
		this.setState((prev: StatsState) => ({
			sortCol: col,
			sortAsc: prev.sortCol === col ? !prev.sortAsc : false,
		}));
	};

	toggleExpand = (species: string) => {
		this.setState((prev: StatsState) => ({
			// Closing the row clears the trends cache + active tab so a fresh
			// expand starts clean; opening pre-selects the detail tab.
			expandedSpecies: prev.expandedSpecies === species ? null : species,
			expandedTab: prev.expandedSpecies === species ? prev.expandedTab : 'detail',
			trendsLoading: prev.expandedSpecies === species ? prev.trendsLoading : false,
			trendsError: prev.expandedSpecies === species ? prev.trendsError : null,
			trendsData: prev.expandedSpecies === species ? prev.trendsData : null,
		}));
	};

	setDetailTab = (tab: DetailTab) => {
		this.setState({ expandedTab: tab });
		if (tab === 'trends') this.fetchTrendData();
	};

	fetchTrendData = async () => {
		const { expandedSpecies, format, range } = this.state;
		if (!expandedSpecies) return;
		this.setState({ trendsLoading: true, trendsError: null });
		try {
			const url = `/api/battlestats/species-trends?format=${encodeURIComponent(format)}&range=${encodeURIComponent(range)}&species=${encodeURIComponent(expandedSpecies)}`;
			const res = await fetch(url);
			if (!res.ok) {
				let detail = '';
				try { const errBody = await res.json(); detail = errBody.error || ''; } catch {}
				throw new Error(detail || `Server returned ${res.status}`);
			}
			const data: SpeciesTrendData = await res.json();
			this.setState({ trendsData: data, trendsLoading: false });
		} catch (err: any) {
			this.setState({ trendsError: err.message || 'Unknown error', trendsLoading: false });
		}
	};

	exportTeam = (team: any[]) => {
		this.copyToClipboard(
			generateTeamExportText(team),
			'Team copied to clipboard',
		);
	};

	fetchRandomTeam = async () => {
		const { format } = this.state;
		this.setState({ randomTeamLoading: true });
		try {
			const url = `/api/battlestats/random-team?format=${encodeURIComponent(format)}`;
			const res = await fetch(url);
			if (!res.ok) {
				let detail = '';
				try { const errBody = await res.json(); detail = errBody.error || ''; } catch {}
				throw new Error(detail || `Server returned ${res.status}`);
			}
			const data: { team: any[] | null } = await res.json();
			if (!data.team || !data.team.length) {
				throw new Error('No team data available for this format.');
			}
			// Display the rolled team visually in the panel; subsequent clicks
			// reroll by replacing this state value with a fresh team.
			this.setState({ randomTeam: data.team, randomTeamLoading: false });
		} catch (err: any) {
			this.setState({
				randomTeamLoading: false,
				copyNotice: `Error: ${err.message || 'Unknown error'}`,
			});
		}
	};

	/**
	 * Copy `text` to the system clipboard and flash a short confirmation
	 * banner in the panel. Falls back to a hidden textarea + execCommand
	 * for environments without the modern Clipboard API.
	 */
	copyToClipboard = async (text: string, message: string) => {
		let copied = false;
		try {
			if (navigator.clipboard?.writeText) {
				await navigator.clipboard.writeText(text);
				copied = true;
			} else {
				const ta = document.createElement('textarea');
				ta.value = text;
				ta.style.position = 'fixed';
				ta.style.opacity = '0';
				document.body.appendChild(ta);
				ta.focus();
				ta.select();
				copied = document.execCommand('copy');
				document.body.removeChild(ta);
			}
		} catch {}
		if (!copied) {
			// eslint-disable-next-line no-console
			console.log(text);
		}
		this.setState({
			copyNotice: copied
				? message
				: 'Could not copy automatically — the full team text was logged to your browser console (open DevTools).',
		});
		// Auto-dismiss the banner after a few seconds. Bump a generation
		// counter so a stale timer cannot wipe a newer banner, and track
		// the timer id so we can cancel on unmount.
		const gen = ++this.copyGeneration;
		if (this.copyTimeoutId !== null) clearTimeout(this.copyTimeoutId);
		this.copyTimeoutId = setTimeout(() => {
			this.copyTimeoutId = null;
			if (this.copyGeneration === gen) this.setState({ copyNotice: null });
		}, 3500);
	};

	dismissCopyNotice = () => {
		if (this.copyTimeoutId !== null) {
			clearTimeout(this.copyTimeoutId);
			this.copyTimeoutId = null;
		}
		this.setState({ copyNotice: null });
	};

	// ---- Render ----

	override render() {
		return <PSPanelWrapper room={this.props.room}>
			<div class="pad">
				{this.renderControls()}
				{this.state.loading && <div class="message message-loading"><p>Loading stats...</p></div>}
				{this.state.error && <div class="message message-error"><p>{this.state.error}</p></div>}
				{!this.state.loading && !this.state.error && this.renderContent()}
			</div>
		</PSPanelWrapper>;
	}

	renderControls() {
		return <div style="margin-bottom: 1em;">
			<select class="button" value={this.state.format} onChange={this.handleChangeFormat} style="min-width: 180px;">
				{FORMATS.map(f => <option value={f.id}>{f.label}</option>)}
			</select>
			{' '}
			<select class="button" value={this.state.range} onChange={this.handleChangeRange}>
				<option value="7d">Last 7 Days</option>
				<option value="30d">Last 30 Days</option>
				<option value="all">All Time</option>
			</select>
			{' '}
			<button class="button" onClick={this.fetchData}>
				<i class="fa fa-refresh"></i> Refresh
			</button>
			{' '}
			{' '}
			<label class="checkbox" style="display:inline-block;vertical-align:middle;margin-left:4px">
				<input
					type="checkbox"
					checked={this.state.showPersonal}
					onChange={(ev: Event) => {
						this.setState({ showPersonal: (ev.target as HTMLInputElement).checked }, this.fetchData);
					}}
				/> My stats only
			</label>
			{' '}
			<input
				class="textbox stats-search"
				type="text"
				placeholder="Filter pokémon..."
				value={this.state.searchQuery}
				onInput={(ev: Event) => this.setState({ searchQuery: (ev.target as HTMLInputElement).value })}
			/>
		</div>;
	}

	renderContent() {
		const categories = this.state.data?.categories || [];
		if (!categories.length) {
			return <div class="message message-info"><p>No battle data found for this format and range.</p></div>;
		}

		return <div>
			{this.renderCopyNotice()}
			{categories.map((cat: any) => <div class="stats-category" key={cat.id}>
				<h3 class="stats-cat-header">{cat.displayFormat || cat.label}</h3>
				{this.renderOverview(cat.battleStats, cat.metaTrends)}
				{this.renderHighlights(cat.pokemonUsage)}
				{this.renderLeaderboards(cat.userLeaderboard)}
				{this.renderTrends(cat.metaTrends, cat.topTeams)}
				{this.renderUsage(cat.pokemonUsage)}
			</div>)}
		</div>;
	}

	// ---- Usage Highlights ----

	renderHighlights(usage: any) {
		if (!usage) return null;
		const { highestWinRatePokemon, lowestWinRatePokemon, mostVersatilePokemon, mostDominantPokemon } = usage;

		// Don't render if no highlight data available
		if (!highestWinRatePokemon && !lowestWinRatePokemon && !mostVersatilePokemon && !mostDominantPokemon) {
			return null;
		}

		return <div class="stats-section">
			<h4>Usage Highlights</h4>
			<div class="stats-highlights">
				{highestWinRatePokemon && <div class="stats-highlight-card highlight-good">
					<span class="highlight-label">Highest Win Rate</span>
					<PSIcon pokemon={highestWinRatePokemon.species} />
					<strong class="highlight-mon">{highestWinRatePokemon.species}</strong>
					<em class="highlight-val">{highestWinRatePokemon.winRate.toFixed(1)}%</em>
				</div>}
				{lowestWinRatePokemon && <div class="stats-highlight-card highlight-bad">
					<span class="highlight-label">Lowest Win Rate</span>
					<PSIcon pokemon={lowestWinRatePokemon.species} />
					<strong class="highlight-mon">{lowestWinRatePokemon.species}</strong>
					<em class="highlight-val">{lowestWinRatePokemon.winRate.toFixed(1)}%</em>
				</div>}
				{mostVersatilePokemon && <div class="stats-highlight-card highlight-info">
					<span class="highlight-label">Most Versatile</span>
					<PSIcon pokemon={mostVersatilePokemon.species} />
					<strong class="highlight-mon">{mostVersatilePokemon.species}</strong>
					<em class="highlight-val">{mostVersatilePokemon.combinations} sets</em>
				</div>}
				{mostDominantPokemon && <div class="stats-highlight-card highlight-warn">
					<span class="highlight-label">Most Dominant</span>
					<PSIcon pokemon={mostDominantPokemon.species} />
					<strong class="highlight-mon">{mostDominantPokemon.species}</strong>
					<em class="highlight-val">{(mostDominantPokemon.dominantScore * 100).toFixed(1)}%</em>
				</div>}
			</div>
		</div>;
	}

	// ---- Overview Metrics ----

	renderOverview(stats: any, metaTrends: any) {
		if (!stats) return null;

		const metrics = [
			{ label: 'All-Time Battles', value: stats.totalBattlesAllTime.toLocaleString() },
			{ label: 'Last 24h', value: stats.battlesLast24h.toLocaleString() },
			{ label: 'Last 30 Days', value: stats.battlesLast30d.toLocaleString() },
			{ label: 'Avg Battles/Day (30d)', value: stats.averageBattlesPerDay30d.toFixed(1) },
			{ label: 'Avg Turns/Battle', value: stats.averageBattleDurationTurns ? stats.averageBattleDurationTurns.toFixed(1) : 'N/A' },
			{ label: 'Forfeit/DC Rate', value: (stats.forfeitDisconnectRate * 100).toFixed(1) + '%' },
			{ label: 'Peak Hour (UTC)', value: stats.peakHourOfDay !== null ? stats.peakHourOfDay + ':00' : 'N/A' },
		];
		if (metaTrends?.formatHealthIndicator !== undefined) {
			metrics.push({
				label: 'Format Health',
				value: (metaTrends.formatHealthIndicator * 100).toFixed(1) + '% unique players',
			});
		}

		return <div class="stats-section">
			<h4>Overview</h4>
			<div class="stats-metrics">
				{metrics.map(m => <div class="stats-metric">
					<span>{m.label}</span><strong>{m.value}</strong>
				</div>)}
			</div>
		</div>;
	}

	// ---- Leaderboards ----

	renderLeaderboards(boards: any) {
		if (!boards) return null;

		const { leaderboardTab } = this.state;
		const rows = boards[leaderboardTab] || [];
		const isStreak = leaderboardTab === 'topByCurrentWinStreak';

		return <div class="stats-section">
			<h4>Player Leaderboards</h4>
			<div class="stats-tabs">
				<button
					class={`button stats-tab${leaderboardTab === 'topByBattles' ? ' cur' : ''}`}
					onClick={() => this.setTab('topByBattles')}
				>Most Battles</button>
				<button
					class={`button stats-tab${leaderboardTab === 'topByWinRate' ? ' cur' : ''}`}
					onClick={() => this.setTab('topByWinRate')}
				>Highest Win Rate</button>
				<button
					class={`button stats-tab${leaderboardTab === 'topByCurrentWinStreak' ? ' cur' : ''}`}
					onClick={() => this.setTab('topByCurrentWinStreak')}
				>Win Streaks</button>
			</div>
			<div class="stats-tab-content">
				<table class="stats-table">
					<thead>
						<tr>
							<th>#</th>
							<th>Player</th>
							{isStreak ? <th>Streak</th> : null}
							<th>Battles</th>
							{!isStreak ? <th>Wins</th> : null}
							{!isStreak ? <th>Win Rate</th> : null}
						</tr>
					</thead>
					<tbody>
						{!rows.length ? <tr><td colSpan={isStreak ? 4 : 5} class="stats-empty">No data yet</td></tr> :
							rows.map((r: any, i: number) => <tr key={r.user}>
								<td>{i + 1}</td>
								<td><strong>{r.user}</strong></td>
								{isStreak ? <td><strong>{r.currentWinStreak}</strong></td> : null}
								<td>{r.battles.toLocaleString()}</td>
								{!isStreak ? <td>{r.wins.toLocaleString()}</td> : null}
								{!isStreak ? <td>{r.winRate.toFixed(1)}%</td> : null}
							</tr>)
						}
					</tbody>
				</table>
			</div>
		</div>;
	}

	// ---- Pokemon Usage Table ----

	renderUsage(usage: any) {
		if (!usage || !usage.pokemon?.length) {
			return <div class="stats-section">
				<h4>Pok&eacute;mon Usage</h4>
				<p class="stats-empty">No pok&eacute;mon data yet.</p>
			</div>;
		}

		const { sortCol, sortAsc, searchQuery } = this.state;

		// Filter by search query (case-insensitive match against species name)
		const filteredPokemon = searchQuery
			? usage.pokemon.filter((p: any) =>
				p.species.toLowerCase().includes(searchQuery.toLowerCase())
			)
			: usage.pokemon;

		// Show a "no results" message if filter matches nothing
		if (searchQuery && !filteredPokemon.length) {
			return <div class="stats-section">
				<h4>Pok&eacute;mon Usage <small>({usage.totalTeamSlots.toLocaleString()} team slots)</small></h4>
				<p class="stats-empty">No pok&eacute;mon match "{searchQuery}".</p>
			</div>;
		}

		// Sort pokemon by the selected column
		const sortedPokemon = [...filteredPokemon].sort((a: any, b: any) => {
			const diff = (a[sortCol] || 0) - (b[sortCol] || 0);
			return sortAsc ? diff : -diff;
		});

		const unfilteredCount = usage.pokemon.length;
		const filteredCount = filteredPokemon.length;

		const SortHeader = ({ col, label }: { col: string; label: string }) => (
			<th onClick={() => this.setSort(col)} class="sortable-header">
				{label} {sortCol === col ? <span class="sort-arrow">{sortAsc ? '\u25B2' : '\u25BC'}</span> : null}
			</th>
		);

		return <div class="stats-section">
			<h4>Pok&eacute;mon Usage <small>({usage.totalTeamSlots.toLocaleString()} team slots{searchQuery ? `, showing ${filteredCount} of ${unfilteredCount}` : ''})</small></h4>
			<div class="stats-tab-content">
				<table class="stats-table stats-usage-table">
					<thead>
						<tr>
							<th>#</th>
							<th>Pok&eacute;mon</th>
							<SortHeader col="usagePct" label="Usage %" />
							<SortHeader col="winRate" label="Win Rate" />
							<SortHeader col="dominantScore" label="Dominance" />
							<th>Top Ability</th>
							<th>Top Item</th>
							<th class="stats-moves-header">Top Moves</th>
							<SortHeader col="versatilityCount" label="Sets" />
						</tr>
					</thead>
					<tbody>
						{							sortedPokemon.map((p: any, i: number) => {
							const topAbility = p.abilities?.[0]
								? `${p.abilities[0].name} (${p.abilities[0].pct.toFixed(0)}%, ${p.abilities[0].winRate.toFixed(0)}% wr)` : '\u2014';
							const topMoves = p.moves?.length
								? p.moves.slice(0, 3).map((m: any) => `${m.name} (${m.pct.toFixed(0)}%, ${m.winRate.toFixed(0)}% wr)`).join(', ')
								: '\u2014';
							const isExpanded = this.state.expandedSpecies === p.species;

						return <preact.Fragment key={p.species}>
						<tr class={`stats-usage-row${isExpanded ? ' expanded' : ''}`} onClick={() => this.toggleExpand(p.species)}>
								<td>{i + 1}</td>
							<td class="stats-moncell">
								<span class="stats-expand-arrow">{isExpanded ? '▼' : '▶'}</span>
								<PSIcon pokemon={p.species} />{' '}
								<strong>{p.species}</strong>
							</td>
								<td>{p.usagePct ? p.usagePct.toFixed(2) + '%' : '\u2014'}</td>
								<td>{p.winRate ? p.winRate.toFixed(1) + '%' : '\u2014'}</td>
								<td>{p.dominantScore != null ? (p.dominantScore * 100).toFixed(1) + '%' : '\u2014'}</td>
								<td>{topAbility}</td>
								<td class="stats-itemcell">
									{p.items?.[0] ? <><PSIcon item={p.items[0].name} /> {p.items[0].name} ({p.items[0].pct.toFixed(0)}%, {p.items[0].winRate.toFixed(0)}% wr)</> : '\u2014'}
								</td>
								<td class="stats-moves-cell">{topMoves}</td>
								<td>{p.versatilityCount}</td>
							</tr>
							{isExpanded && this.renderExpandedDetail(p)}
						</preact.Fragment>;
						})}
					</tbody>
				</table>
			</div>
		</div>;
	}

	// ---- Expanded Detail Row ----

	renderExpandedDetail(p: any) {
		// Helper: render a simple list of {name, pct, winRate} entries
		const renderSimpleList = (items: any[], showIcon: boolean) => {
			if (!items || !items.length) return <p class="stats-empty">No data</p>;
			return <ul class="stats-detail-list">
				{items.map((entry: any) => (
					<li class="stats-detail-item" key={entry.name}>
						<span class="stats-detail-label">
							{showIcon && <PSIcon item={entry.name} />}
							{entry.name}
						</span>
						<span class="stats-detail-numbers">
							<span class="stats-detail-pct">{entry.pct.toFixed(1)}%</span>
							{typeof entry.winRate === 'number' && (
								<span class="stats-detail-winrate" title="Win rate when this ability/item/move is used">{entry.winRate.toFixed(1)}% wr</span>
							)}
						</span>
					</li>
				))}
			</ul>;
		};

		// Helper: render counters list
		const renderCounters = (counters: any[]) => {
			if (!counters || !counters.length) return <p class="stats-empty">Not enough data</p>;
			return <ul class="stats-detail-list">
				{counters.map((c: any) => (
					<li class="stats-detail-item" key={c.species}>
						<span class="stats-detail-label">
							<PSIcon pokemon={c.species} />
							{c.species}
						</span>
						<span class="stats-detail-pct" title={`${c.encounters} encounters`}>
							{c.lossRate.toFixed(0)}% loss
						</span>
					</li>
				))}
			</ul>;
		};

		const { expandedTab, trendsLoading, trendsError } = this.state;

		return <tr class="stats-expanded-row" key={`${p.species}-detail`}>
			<td colSpan={9} class="stats-expanded-cell">
				<div class="stats-detail-tabs">
					<button
						class={`button stats-detail-tab${expandedTab === 'detail' ? ' cur' : ''}`}
						onClick={() => this.setDetailTab('detail')}
					>Details</button>
					<button
						class={`button stats-detail-tab${expandedTab === 'trends' ? ' cur' : ''}`}
						onClick={() => this.setDetailTab('trends')}
					>Trends</button>
				</div>
				{expandedTab === 'detail' && <div class="stats-detail-grid">
					<div class="stats-detail-col">
						<h5>Abilities</h5>
						{renderSimpleList(p.abilities, false)}
					</div>
					<div class="stats-detail-col">
						<h5>Items</h5>
						{renderSimpleList(p.items, true)}
					</div>
					<div class="stats-detail-col">
						<h5>Moves</h5>
						{renderSimpleList(p.moves, false)}
					</div>
					<div class="stats-detail-col">
						<h5>Counters</h5>
						{renderCounters(p.counters)}
					</div>
				</div>}
				{expandedTab === 'trends' && <div class="stats-trend-pane">
					{trendsLoading && <div class="message message-loading"><p>Loading trends…</p></div>}
					{trendsError && <div class="message message-error"><p>{trendsError}</p></div>}
					{!trendsLoading && !trendsError && this.renderTrendChart(p)}
				</div>}
			</td>
		</tr>;
	}

	// ---- Meta Trends (now includes Top Teams above "Most Common Core") ----

	renderTrends(trends: any, teams: any[]) {
		if (!trends && !(teams && teams.length)) return null;

		return <div class="stats-section">
			<h4>Meta Trends</h4>
			{teams && teams.length > 0 && <div class="stats-teams-block">
				<h5 class="stats-team-subheader">Top Teams</h5>
				<div class="stats-team-list">
					{teams.map((t: any, i: number) => <div class="stats-team-card" key={t.signature}>
						<div class="stats-team-header">
							<strong>#{i + 1}</strong>
							<span class="stats-team-stats">
								{t.appearances} appearances · {(t.winRate || 0).toFixed(1)}% win rate
							</span>
							<button
								class="button stats-team-export-btn"
								onClick={() => this.exportTeam(t.team)}
								title="Copy this team in Showdown importable format"
							>
								<i class="fa fa-download"></i> Export to text
							</button>
						</div>
						<div class="stats-team-species">
							{(t.signature || '').split('/').filter(Boolean).map((species: string) =>
								<span class="stats-team-mon" key={species}>
									<PSIcon pokemon={species} />{' '}{species}
								</span>
							)}
						</div>
					</div>)}
				</div>
				<div class="stats-teams-footer">
					<button
						class="button"
						disabled={this.state.randomTeamLoading}
						onClick={this.fetchRandomTeam}
						title={this.state.randomTeam
							? 'Pick another random team from recorded battles'
							: 'Pick a random team from recorded battles'}
					>
						<i class="fa fa-random"></i>{' '}
						{this.state.randomTeamLoading
							? 'Loading…'
							: this.state.randomTeam ? 'Reroll' : 'Random team'}
					</button>
				</div>
				{this.state.randomTeam && this.renderRandomTeam()}
			</div>}
			{trends && trends.mostCommonCore && <div class="stats-meta-item">
				<strong>Most Common Core:</strong>{' '}
				<PSIcon pokemon={trends.mostCommonCore.pokemonA} /> {trends.mostCommonCore.pokemonA} +{' '}
				<PSIcon pokemon={trends.mostCommonCore.pokemonB} /> {trends.mostCommonCore.pokemonB}{' '}
				<small>({trends.mostCommonCore.count} teams)</small>
			</div>}
			{trends && trends.topCommonCores?.length > 1 && <ul class="stats-core-list">
				{trends.topCommonCores.slice(1, 6).map((core: any) =>
					<li key={core.pokemonA + core.pokemonB}>
						<PSIcon pokemon={core.pokemonA} /> {core.pokemonA} +{' '}
						<PSIcon pokemon={core.pokemonB} /> {core.pokemonB}{' '}
						({core.count} teams)
					</li>
				)}
			</ul>}
		</div>;
	}

	// ---- Random Team (display card after the first roll; rerolls from the same button) ----

	renderRandomTeam() {
		const team = this.state.randomTeam;
		if (!team) return null;
		// Match the top-teams card visually (icon + name per slot) so users
		// can scan the rolled team at a glance, and offer the same Export
		// button so a picked team can be moved into the teambuilder.
		// Iterate in API order rather than sorting, since the server returns
		// BattleStatsPokemon[] without a sorted signature.
		return <div class="stats-team-card stats-random-team-card">
			<div class="stats-team-header">
				<strong>Random Team</strong>
				<span class="stats-team-stats">Press the button to reroll</span>
				<button
					class="button stats-team-export-btn"
					onClick={() => this.exportTeam(team)}
					title="Copy this team in Showdown importable format"
				>
					<i class="fa fa-download"></i> Export to text
				</button>
			</div>
			<div class="stats-team-species">
				{team.map((mon: any) => <span class="stats-team-mon" key={mon.species}>
					<PSIcon pokemon={mon.species} />{' '}{mon.species}
				</span>)}
			</div>
		</div>;
	}

	// ---- Copy Notice (flash banner after clipboard copy) ----

	renderCopyNotice() {
		if (!this.state.copyNotice) return null;
		return <div class="stats-copy-notice">
			<span>{this.state.copyNotice}</span>
			<button class="button" onClick={this.dismissCopyNotice} title="Dismiss">
				<i class="fa fa-times"></i>
			</button>
		</div>;
	}

	// ---- Trends Chart (inline SVG) ----

	renderTrendChart(p: any) {
		const days = this.state.trendsData?.days || [];
		if (!days.length) {
			return <p class="stats-empty">No trend data yet.</p>;
		}
		const W = 480, H = 150;
		const pad = { top: 26, right: 14, bottom: 30, left: 38 };
		const cw = W - pad.left - pad.right;
		const ch = H - pad.top - pad.bottom;
		const xAt = (i: number) => pad.left + (days.length === 1 ? cw / 2 : (i / (days.length - 1)) * cw);
		const yAt = (pct: number) => pad.top + ch - (Math.min(pct, 100) / 100) * ch;
		const usagePts = days.map((d, i) => `${xAt(i)},${yAt(d.usagePct)}`).join(' ');
		const winPts = days.map((d, i) => `${xAt(i)},${yAt(d.winRate)}`).join(' ');
		// Show ~5–6 x labels even when many days are present.
		const labelEvery = Math.max(1, Math.ceil(days.length / 6));
		const gridLevels = [0, 25, 50, 75, 100];
		return <svg viewBox={`0 0 ${W} ${H}`} class="stats-trend-chart" preserveAspectRatio="xMidYMid meet">
			{gridLevels.map(p => <g>
				<line x1={pad.left} y1={yAt(p)} x2={W - pad.right} y2={yAt(p)} stroke="#dddddd" stroke-dasharray="3,3" />
				<text x={pad.left - 6} y={yAt(p)} text-anchor="end" dominant-baseline="middle" font-size="11" fill="#888">{p}%</text>
			</g>)}
			<polyline points={usagePts} fill="none" stroke="#337ab7" stroke-width="2" />
			<polyline points={winPts} fill="none" stroke="#28a745" stroke-width="2" />
			{days.map((d, i) => <g>
				<circle cx={xAt(i)} cy={yAt(d.usagePct)} r="3" fill="#337ab7">
					<title>{`${d.date}: usage ${d.usagePct.toFixed(1)}%`}</title>
				</circle>
				<circle cx={xAt(i)} cy={yAt(d.winRate)} r="3" fill="#28a745">
					<title>{`${d.date}: win rate ${d.winRate.toFixed(1)}%`}</title>
				</circle>
				{i % labelEvery === 0 || i === days.length - 1 ? <text x={xAt(i)} y={H - 10} text-anchor="middle" font-size="10" fill="#666">{d.date.slice(5)}</text> : null}
			</g>)}
			<g transform={`translate(${pad.left}, ${pad.top - 12})`}>
				<line x1="0" y1="0" x2="14" y2="0" stroke="#337ab7" stroke-width="2" />
				<text x="20" y="4" font-size="11" fill="#337ab7">Usage %</text>
				<line x1="80" y1="0" x2="94" y2="0" stroke="#28a745" stroke-width="2" />
				<text x="100" y="4" font-size="11" fill="#28a745">Win Rate %</text>
			</g>
		</svg>;
	}

	// Tracks the in-flight auto-dismiss timeout + the active notice so we
	// can cancel on unmount and stop a stale timer from dismissing a newer
	// banner (each invocation bumps `copyGeneration`).
	private copyTimeoutId: ReturnType<typeof setTimeout> | null = null;
	private copyGeneration = 0;

	override componentWillUnmount() {
		if (this.copyTimeoutId !== null) {
			clearTimeout(this.copyTimeoutId);
			this.copyTimeoutId = null;
		}
	}
}

PS.addRoomType(StatsPanel);
