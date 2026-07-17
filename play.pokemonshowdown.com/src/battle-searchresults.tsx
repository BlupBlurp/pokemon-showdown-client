/**
 * Search Results
 *
 * Code for displaying sesrch results from battle-dex-search.ts
 *
 * @author Guangcong Luo <guangcongluo@gmail.com>
 * @license AGPLv3
 */

import preact from "../js/lib/preact";
import { Dex, toID, type ID } from "./battle-dex";
import type { DexSearch, SearchRow, SearchType } from "./battle-dex-search";
import { Config } from "./client-main";
import { RelumiDiffHelper } from "./battle-relumi-diff";

const RESULT_ROW_HEIGHT = 33;
const RESULT_OVERSCAN_ROWS = 12;
const RESULT_REFILL_THRESHOLD_ROWS = 4;

function escapeHTML(text: string | number | null | undefined) {
	if (typeof text === 'number') text = `${text}`;
	if (typeof text !== 'string') return '';
	if (!/[&<>"]/.test(text)) return text;
	return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function escapeCSSString(text: string) {
	return text.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\a ').replace(/\r/g, '\\d ');
}

export class PSSearchResults extends preact.Component<{
	search: DexSearch, class?: string, style?: string | null,
	prepend?: preact.ComponentChildren, children?: preact.ComponentChildren,
	hideFilters?: boolean,
	/** type = '' means a filter was selected,
	  * null means a sort was selected (clear not needed) */
	onSelect?: (type: SearchType | '' | null, name: string, moveSlot?: string) => void,
}> {
	speciesId: ID = '' as ID;
	itemId: ID = '' as ID;
	abilityId: ID = '' as ID;
	moveIds: ID[] = [];
	scrollFrame = 0;
	renderedStart = -1;
	renderedEnd = -1;
	renderedLength = -1;

	// Per-search memos for Relumi diff/lookup helpers. Cleared at the start of
	// each render cycle so the same species/move/move-field lookups don't repeat.
	private _relumiHighlightCached: boolean | undefined;

	// Shared Relumi balance-change highlighting state. See battle-relumi-diff.ts.
	private readonly _relumi = new RelumiDiffHelper({
		getDex: () => this.props.search.dex,
		shouldHighlight: () => {
			if (this._relumiHighlightCached !== undefined) return this._relumiHighlightCached;
			if (Dex.prefs('relumiHighlightBalanceChangesTB') === false) {
				return (this._relumiHighlightCached = false);
			}
			if (this.props.search.dex.modid === 'gen8relumi') {
				return (this._relumiHighlightCached = true);
			}
			const format = this.props.search.typedSearch?.format || '';
			return (this._relumiHighlightCached = format.includes('relumi'));
		},
	});

	private getBSTDiff(speciesId: ID, currentBST: number): { vanilla: number, delta: number } | null {
		const cacheKey = `bstDiff|${speciesId}|${currentBST}`;
		if (this._relumi.cacheHas(cacheKey)) return this._relumi.cacheGet<{ vanilla: number, delta: number } | null>(cacheKey);
		let result: { vanilla: number, delta: number } | null = null;
		if (!this._relumi.shouldHighlightRelumiChanges()) {
			this._relumi.cacheSet(cacheKey, result);
			return result;
		}
		const relumiTable = this._relumi.getRelumiOverrides();
		if (!relumiTable?.overrideSpeciesData) {
			this._relumi.cacheSet(cacheKey, result);
			return result;
		}
		const diffSourceId = this._relumi.getRelumiDiffSourceSpeciesId(speciesId);
		const relumiSpeciesDiff = relumiTable.overrideSpeciesData[diffSourceId];
		if (!relumiSpeciesDiff) {
			this._relumi.cacheSet(cacheKey, result);
			return result;
		}

		let vanillaComparisonId: ID;
		let vanillaSpecies: Dex.Species | null;
		if (relumiSpeciesDiff.baseStats) {
			vanillaComparisonId = this._relumi.getVanillaComparisonSpeciesId(diffSourceId);
			vanillaSpecies = this._relumi.getVanillaSpeciesData(vanillaComparisonId);
			if (!vanillaSpecies?.baseStats) {
				this._relumi.cacheSet(cacheKey, result);
				return result;
			}
		} else {
			if (this._relumi.getVanillaSpeciesData(speciesId)) {
				this._relumi.cacheSet(cacheKey, result);
				return result;
			}
			vanillaComparisonId = this._relumi.getVanillaComparisonSpeciesId(speciesId);
			vanillaSpecies = this._relumi.getVanillaSpeciesData(vanillaComparisonId);
			if (!vanillaSpecies?.baseStats) {
				this._relumi.cacheSet(cacheKey, result);
				return result;
			}
		}

		let vanillaBST = 0;
		for (const stat in vanillaSpecies.baseStats) {
			vanillaBST += vanillaSpecies.baseStats[stat as Dex.StatName];
		}
		if (typeof vanillaBST !== 'number' || vanillaBST === currentBST) {
			this._relumi.cacheSet(cacheKey, result);
			return result;
		}
		result = { vanilla: vanillaBST, delta: currentBST - vanillaBST };
		this._relumi.cacheSet(cacheKey, result);
		return result;
	}
	private getBSTClass(speciesId: ID, currentBST: number) {
		const diff = this.getBSTDiff(speciesId, currentBST);
		if (!diff) return '';
		return diff.delta > 0 ? 'relumi-change-up' : 'relumi-change-down';
	}

	private getMoveDiff(
		moveId: ID, valueType: 'basePower' | 'accuracy', value: number | true
	): { vanilla: number | true, delta: number } | null {
		const cacheKey = `moveDiff|${moveId}|${valueType}|${String(value)}`;
		if (this._relumi.cacheHas(cacheKey)) return this._relumi.cacheGet<{ vanilla: number | true, delta: number } | null>(cacheKey);
		let result: { vanilla: number | true, delta: number } | null = null;
		if (!this._relumi.shouldHighlightRelumiChanges()) {
			this._relumi.cacheSet(cacheKey, result);
			return result;
		}
		const relumiTable = this._relumi.getRelumiOverrides();
		if (!relumiTable?.overrideMoveData) {
			this._relumi.cacheSet(cacheKey, result);
			return result;
		}
		const relumiMoveDiff = relumiTable.overrideMoveData[moveId];
		if (!relumiMoveDiff || relumiMoveDiff[valueType] === undefined) {
			this._relumi.cacheSet(cacheKey, result);
			return result;
		}
		const vanillaMove = this._relumi.getVanillaMoveData(moveId);
		if (!vanillaMove) {
			this._relumi.cacheSet(cacheKey, result);
			return result;
		}
		const vanillaValue = vanillaMove[valueType];
		if (typeof vanillaValue !== 'number' && vanillaValue !== true) {
			this._relumi.cacheSet(cacheKey, result);
			return result;
		}
		if (typeof value !== 'number' && value !== true) {
			this._relumi.cacheSet(cacheKey, result);
			return result;
		}
		if (value === vanillaValue) {
			this._relumi.cacheSet(cacheKey, result);
			return result;
		}
		// Compute delta even when one side is `true` (always-hit flag). For the
		// "true" sentinel, there's no meaningful numeric delta, so use a unit +/- 1.
		if (value === true && vanillaValue !== true) {
			result = { vanilla: vanillaValue, delta: 1 };
		} else if (value !== true && vanillaValue === true) {
			result = { vanilla: vanillaValue, delta: -1 };
		} else if (typeof value === 'number' && typeof vanillaValue === 'number') {
			result = { vanilla: vanillaValue, delta: value - vanillaValue };
		}
		this._relumi.cacheSet(cacheKey, result);
		return result;
	}
	private getMoveChangeClass(moveId: ID, valueType: 'basePower' | 'accuracy', value: number | true) {
		const diff = this.getMoveDiff(moveId, valueType, value);
		if (!diff) return '';
		return diff.delta > 0 ? 'relumi-change-up' : 'relumi-change-down';
	}
	private isNewRelumiLearnset(moveId: ID): boolean {
		if (!this._relumi.shouldHighlightRelumiChanges()) return false;
		const typedSearch = this.props.search.typedSearch;
		if (!typedSearch?.species) return false;
		const currentSpeciesId = typedSearch.species;
		const relumiTable = this._relumi.getRelumiOverrides();
		if (!relumiTable?.learnsets) return false;
		const relumiLearnsets = relumiTable.learnsets;
		const vanillaLearnsets = (window as any).BattleTeambuilderTable?.learnsets;
		if (!vanillaLearnsets) return false;
		return this.canLearnInChain(currentSpeciesId, moveId, relumiLearnsets) &&
			!this.canLearnInChain(currentSpeciesId, moveId, vanillaLearnsets);
	}
	private canLearnInChain(
		speciesId: ID, moveId: ID, learnsets: any, visited: Record<string, true> = Object.create(null)
	): boolean {
		const learnsetid = this.getFirstLearnsetId(speciesId, learnsets);
		let cur: ID = learnsetid;
		while (cur) {
			if (visited[cur]) return false; // guard against chain cycles
			visited[cur] = true;
			const learnset = learnsets[cur];
			if (learnset && moveId in learnset) return true;
			cur = this.getNextLearnsetId(cur, speciesId, learnsets);
		}
		return false;
	}
	private getFirstLearnsetId(speciesId: ID, learnsets: any): ID {
		if (speciesId in learnsets) return speciesId;
		const species = this.props.search.dex.species.get(speciesId);
		if (!species?.exists) return '' as ID;
		let baseLearnsetid: ID = toID(species.baseSpecies);
		if (typeof species.battleOnly === 'string' && species.battleOnly !== species.baseSpecies) {
			baseLearnsetid = toID(species.battleOnly);
		}
		if (baseLearnsetid in learnsets) return baseLearnsetid;
		return '' as ID;
	}
	private getNextLearnsetId(learnsetid: ID, speciesId: ID, learnsets: any): ID {
		const lsetSpecies = this.props.search.dex.species.get(learnsetid);
		if (!lsetSpecies?.exists) return '' as ID;
		// Special cases for specific forms
		if (learnsetid === 'lycanrocdusk' || (speciesId === 'rockruff' && learnsetid === 'rockruff')) {
			return 'rockruffdusk' as ID;
		}
		if (lsetSpecies.id === 'gastrodoneast') return 'gastrodon' as ID;
		if (lsetSpecies.id === 'pumpkaboosuper') return 'pumpkaboo' as ID;
		if (lsetSpecies.id === 'sinisteaantique') return 'sinistea' as ID;
		if (lsetSpecies.id === 'tatsugiristretchy') return 'tatsugiri' as ID;
		const next = lsetSpecies.battleOnly || lsetSpecies.changesFrom || lsetSpecies.prevo;
		if (next) return toID(next);
		return '' as ID;
	}
	private getMoveFlagsTooltip(move: Dex.Move): string {
		const parts: string[] = [];
		if (move.flags.contact) parts.push('Contact');
		if (move.flags.slicing) parts.push('Slicing');
		if (move.flags.sound) parts.push('Sound');
		if (move.flags.punch) parts.push('Punch');
		if (move.flags.bite) parts.push('Bite');
		if (move.flags.pulse) parts.push('Pulse');
		if (move.flags.bullet) parts.push('Bullet');
		if (move.flags.powder) parts.push('Powder');
		if (move.flags.wind) parts.push('Wind');
		if (move.flags.dance) parts.push('Dance');
		if (move.flags.bypasssub) parts.push('Bypasses Sub');
		if (move.priority) parts.push(`Priority: ${move.priority > 0 ? '+' : ''}${move.priority}`);
		return parts.join(', ');
	}
	private parseMethodCode(methodCode: string): string | null {
		if (!methodCode) return null;
		// Handle pipe-delimited vanilla format: "genavail|L25,M"
		// Handle Relumi format: "9l25,9m,9e" (lowercase, prefixed with '9')
		let methods: string[];
		if (methodCode.includes('|')) {
			methods = methodCode.split('|')[1].split(',');
		} else if (/^\d/.test(methodCode)) {
			// Relumi format: "9l25,9m" → strip gen prefix, uppercase
			methods = methodCode.split(',').map(m => m.replace(/^\d+/, '').toUpperCase());
		} else {
			methods = methodCode.split(',');
		}
		const parts: string[] = [];
		for (const m of methods) {
			const levelMatch = m.match(/^L(\d+)$/);
			if (levelMatch) {
				const lvl = parseInt(levelMatch[1]);
				parts.push(lvl === 0 ? 'Lv1' : `Lv${levelMatch[1]}`);
			} else if (m === 'M') {
				parts.push('TM');
			} else if (m === 'T') {
				parts.push('Tutor');
			} else if (m === 'E') {
				parts.push('Egg');
			} else if (m === 'V') {
				parts.push('Event');
			}
		}
		return parts.length ? parts.join(' / ') : null;
	}

	private parseDescriptionTags(desc: string): string {
		if (!desc) return '';
		// [buff]text[/buff] → relumi-change-up, [nerf]text[/nerf] → relumi-change-down.
		const out: string[] = [];
		const regex = /\[(buff|nerf)\](.*?)\[\/\1\]/g;
		let lastIndex = 0;
		let match: RegExpExecArray | null;
		while ((match = regex.exec(desc)) !== null) {
			if (match.index > lastIndex) out.push(escapeHTML(desc.slice(lastIndex, match.index)));
			const tag = match[1];
			const inner = match[2];
			const cls = tag === 'buff' ? 'relumi-change-up' : 'relumi-change-down';
			out.push(`<span class="${cls}">${escapeHTML(inner)}</span>`);
			lastIndex = match.index + match[0].length;
		}
		if (lastIndex < desc.length) out.push(escapeHTML(desc.slice(lastIndex)));
		return out.join('');
	}

	renderPokemonSortRowHTML(index: number) {
		const search = this.props.search;
		const sortCol = search.sortCol;
		return [
			`<li class="result" value="${index}"><div class="sortrow">`,
			`<button class="sortcol numsortcol${!sortCol ? ' cur' : ''}">`,
			`${!sortCol ? 'Sort: ' : escapeHTML(search.firstPokemonColumn)}</button>`,
			`<button class="sortcol pnamesortcol${sortCol === 'name' ? ' cur' : ''}" data-sort="name">Name</button>`,
			`<button class="sortcol typesortcol${sortCol === 'type' ? ' cur' : ''}" data-sort="type">Types</button>`,
			`<button class="sortcol abilitysortcol${sortCol === 'ability' ? ' cur' : ''}" data-sort="ability">Abilities</button>`,
			`<button class="sortcol statsortcol${sortCol === 'hp' ? ' cur' : ''}" data-sort="hp">HP</button>`,
			`<button class="sortcol statsortcol${sortCol === 'atk' ? ' cur' : ''}" data-sort="atk">Atk</button>`,
			`<button class="sortcol statsortcol${sortCol === 'def' ? ' cur' : ''}" data-sort="def">Def</button>`,
			`<button class="sortcol statsortcol${sortCol === 'spa' ? ' cur' : ''}" data-sort="spa">SpA</button>`,
			`<button class="sortcol statsortcol${sortCol === 'spd' ? ' cur' : ''}" data-sort="spd">SpD</button>`,
			`<button class="sortcol statsortcol${sortCol === 'spe' ? ' cur' : ''}" data-sort="spe">Spe</button>`,
			`<button class="sortcol statsortcol${sortCol === 'bst' ? ' cur' : ''}" data-sort="bst">BST</button>`,
			`</div></li>`,
		].join('');
	}

	renderMoveSortRowHTML(index: number) {
		const sortCol = this.props.search.sortCol;
		return `<li class="result" value="${index}"><div class="sortrow">` +
			`<button class="sortcol movenamesortcol${sortCol === 'name' ? ' cur' : ''}" data-sort="name">Name</button>` +
			`<button class="sortcol movetypesortcol${sortCol === 'type' ? ' cur' : ''}" data-sort="type">Type</button>` +
			`<button class="sortcol movetypesortcol${sortCol === 'category' ? ' cur' : ''}" data-sort="category">Cat</button>` +
			`<button class="sortcol powersortcol${sortCol === 'power' ? ' cur' : ''}" data-sort="power">Pow</button>` +
			`<button class="sortcol accuracysortcol${sortCol === 'accuracy' ? ' cur' : ''}" data-sort="accuracy">Acc</button>` +
			`<button class="sortcol ppsortcol${sortCol === 'pp' ? ' cur' : ''}" data-sort="pp">PP</button>` +
			`</div></li>`;
	}

	renderPokemonRowHTML(index: number, id: ID, matchStart: number, matchEnd: number, errorMessage?: string) {
		const search = this.props.search;
		const pokemon = search.dex.species.get(id);
		if (!pokemon) return `<li class="result" value="${index}">Unrecognized pokemon</li>`;

		const tagStart = (pokemon.forme ? pokemon.name.length - pokemon.forme.length - 1 : 0);
		const stats = pokemon.baseStats;
		const hpClass = this._relumi.getStatClass(id, 'hp', stats.hp);
		const atkClass = this._relumi.getStatClass(id, 'atk', stats.atk);
		const defClass = this._relumi.getStatClass(id, 'def', stats.def);
		const spaClass = this._relumi.getStatClass(id, 'spa', stats.spa);
		const spdClass = this._relumi.getStatClass(id, 'spd', stats.spd);
		const speClass = this._relumi.getStatClass(id, 'spe', stats.spe);
		const hpDiff = this._relumi.getStatDiff(id, 'hp', stats.hp);
		const atkDiff = this._relumi.getStatDiff(id, 'atk', stats.atk);
		const defDiff = this._relumi.getStatDiff(id, 'def', stats.def);
		const spaDiff = this._relumi.getStatDiff(id, 'spa', stats.spa);
		const spdDiff = this._relumi.getStatDiff(id, 'spd', stats.spd);
		const speDiff = this._relumi.getStatDiff(id, 'spe', stats.spe);
		const ability0NewClass = this._relumi.isNewRelumiAbility(id, pokemon.abilities['0']) ?
			'relumi-change-up' : '';
		const ability1NewClass = pokemon.abilities['1'] &&
			this._relumi.isNewRelumiAbility(id, pokemon.abilities['1']) ? 'relumi-change-up' : '';
		const hiddenAbilityNewClass = pokemon.abilities['H'] &&
			this._relumi.isNewRelumiAbility(id, pokemon.abilities['H']) ? 'relumi-change-up' : '';
		const specialAbilityNewClass = pokemon.abilities['S'] &&
			this._relumi.isNewRelumiAbility(id, pokemon.abilities['S']) ? 'relumi-change-up' : '';
		let bst = 0;
		for (const stat of Object.values(stats)) bst += stat;
		if (search.dex.gen < 2) bst -= stats['spd'];
		const bstClass = this.getBSTClass(id, bst);
		const bstDiff = this.getBSTDiff(id, bst);
		const fmtStatTitle = (diff: { vanilla: number, delta: number } | null) =>
			diff ? `Vanilla: ${diff.vanilla} → ${diff.delta + diff.vanilla} (${diff.delta > 0 ? '+' : ''}${diff.delta})` : '';
		const fmtBSTTitle = bstDiff ?
			`Vanilla BST: ${bstDiff.vanilla} → ${bst} (${bstDiff.delta > 0 ? '+' : ''}${bstDiff.delta})` :
			'';

		let buf = `<li class="result" value="${index}"><a href="${Dex.getLuminescentUrl('pokemon', id)}" ` +
			`class="${id === this.speciesId ? 'cur' : ''}" data-target="push" ` +
			`data-entry="pokemon|${escapeHTML(pokemon.name)}">` +
			`<span class="col numcol">${escapeHTML(search.getTier(pokemon))}</span>` +
			`<span class="col iconcol"><span class="pixelated" style="${escapeHTML(Dex.getPokemonIcon(pokemon.id))}"></span></span>` +
			`<span class="col pokemonnamecol">${this.renderNameHTML(pokemon.name, matchStart, matchEnd, tagStart)}</span>`;
		if (errorMessage) return `${buf}${errorMessage}</a></li>`;

		buf += `<span class="col typecol">${pokemon.types.map(type =>
			`<img src="${Dex.resourcePrefix}sprites/types/${type}.png" alt="${escapeHTML(type)}" height="14" width="32" class="pixelated" />`
		).join('')}</span>`;

		if (search.dex.gen >= 3) {
			buf += pokemon.abilities['1'] ?
				`<span class="col twoabilitycol"><span class="${ability0NewClass}">${escapeHTML(pokemon.abilities['0'])}</span><br /><span class="${ability1NewClass}">${escapeHTML(pokemon.abilities['1'])}</span></span>` :
				`<span class="col abilitycol"><span class="${ability0NewClass}">${escapeHTML(pokemon.abilities['0'])}</span></span>`;
		}
		if (search.dex.gen >= 5) {
			if (pokemon.abilities['S']) {
				buf += `<span class="col twoabilitycol${pokemon.unreleasedHidden ? ' unreleasedhacol' : ''}">` +
					`<span class="${hiddenAbilityNewClass}">${escapeHTML(pokemon.abilities['H'] || '')}</span><br /><span class="${specialAbilityNewClass}">${escapeHTML(pokemon.abilities['S'])}</span></span>`;
			} else if (pokemon.abilities['H']) {
				buf += `<span class="col abilitycol${pokemon.unreleasedHidden ? ' unreleasedhacol' : ''}">` +
					`<span class="${hiddenAbilityNewClass}">${escapeHTML(pokemon.abilities['H'])}</span></span>`;
			} else {
				buf += `<span class="col abilitycol"></span>`;
			}
		}

		buf += `<span class="col statcol" title="${fmtStatTitle(hpDiff)}"><em>HP</em><br /><span class="${hpClass}">${stats.hp}</span></span>` +
			`<span class="col statcol" title="${fmtStatTitle(atkDiff)}"><em>Atk</em><br /><span class="${atkClass}">${stats.atk}</span></span>` +
			`<span class="col statcol" title="${fmtStatTitle(defDiff)}"><em>Def</em><br /><span class="${defClass}">${stats.def}</span></span>` +
			(search.dex.gen >= 2 ?
				`<span class="col statcol" title="${fmtStatTitle(spaDiff)}"><em>SpA</em><br /><span class="${spaClass}">${stats.spa}</span></span>` +
				`<span class="col statcol" title="${fmtStatTitle(spdDiff)}"><em>SpD</em><br /><span class="${spdClass}">${stats.spd}</span></span>` :
				`<span class="col statcol" title="${fmtStatTitle(spaDiff)}"><em>Spc</em><br /><span class="${spaClass}">${stats.spa}</span></span>`) +
				`<span class="col statcol" title="${fmtStatTitle(speDiff)}"><em>Spe</em><br /><span class="${speClass}">${stats.spe}</span></span>` +
				`<span class="col bstcol ${bstClass}" title="${fmtBSTTitle}"><em>BST<br />${bst}</em></span></a></li>`;
		return buf;
	}

	renderNameHTML(name: string, matchStart: number, matchEnd: number, tagStart?: number) {
		if (name === 'No Ability') return `<i>(no ability)</i>`;

		if (!matchEnd) {
			if (!tagStart) return escapeHTML(name);
			return `${escapeHTML(name.slice(0, tagStart))}<small>${escapeHTML(name.slice(tagStart))}</small>`;
		}

		let output = escapeHTML(name.slice(0, matchStart)) +
			`<b>${escapeHTML(name.slice(matchStart, matchEnd))}</b>` +
			escapeHTML(name.slice(matchEnd, tagStart || name.length));
		if (!tagStart) return output;

		if (matchEnd && matchEnd > tagStart) {
			output += `<small>${escapeHTML(name.slice(matchEnd))}</small>`;
		} else {
			output += `<small>${escapeHTML(name.slice(tagStart))}</small>`;
		}

		return output;
	}

	renderItemRowHTML(index: number, id: ID, matchStart: number, matchEnd: number, errorMessage?: string) {
		const search = this.props.search;
		const item = search.dex.items.get(id);
		if (!item) return `<li class="result" value="${index}">Unrecognized item</li>`;

		return `<li class="result" value="${index}"><a href="${Dex.getLuminescentUrl('item', id)}" ` +
			`class="${id === this.itemId ? 'cur' : ''}" data-target="push" data-entry="item|${escapeHTML(item.name)}">` +
			`<span class="col itemiconcol"><span class="pixelated" style="${escapeHTML(Dex.getItemIcon(item))}"></span></span>` +
			`<span class="col namecol">${id ? this.renderNameHTML(item.name, matchStart, matchEnd) : '<i>(no item)</i>'}</span>` +
			(id ? (errorMessage || '') : '') +
			(!errorMessage ? `<span class="col itemdesccol">${escapeHTML(item.shortDesc)}</span>` : '') +
			`</a></li>`;
	}

	renderAbilityRowHTML(index: number, id: ID, matchStart: number, matchEnd: number, errorMessage?: string) {
		const search = this.props.search;
		const ability = search.dex.abilities.get(id);
		if (!ability) return `<li class="result" value="${index}">Unrecognized ability</li>`;

		return `<li class="result" value="${index}"><a href="${Dex.getLuminescentUrl('ability', id)}" ` +
			`class="${id === this.abilityId ? 'cur' : ''}" data-target="push" data-entry="ability|${escapeHTML(ability.name)}">` +
			`<span class="col namecol">${id ? this.renderNameHTML(ability.name, matchStart, matchEnd) : '<i>(no ability)</i>'}</span>` +
			(errorMessage || '') +
			(!errorMessage ? `<span class="col abilitydesccol">${this.parseDescriptionTags(ability.shortDesc)}</span>` : '') +
			`</a></li>`;
	}

	renderMoveRowHTML(index: number, id: ID, matchStart: number, matchEnd: number, errorMessage?: string) {
		let slot = null;
		if (id.startsWith('_')) {
			[slot, id] = id.slice(1).split('_') as [string, ID];
			if (!id) {
				return `<li class="result" value="${index}"><a href="//${Config.routes.dex}/moves/" class="cur" ` +
					`data-target="push" data-entry="move||${escapeHTML(slot)}">` +
					`<span class="col movenamecol"><i>(slot ${escapeHTML(slot)} empty)</i></span></a></li>`;
			}
		}

		const search = this.props.search;
		const move = search.dex.moves.get(id);
		if (!move) return `<li class="result" value="${index}">Unrecognized move</li>`;
		const entry = slot ? `move|${move.name}|${slot}` : `move|${move.name}`;
		const tagStart = (move.name.startsWith('Hidden Power') ? 12 : 0);

		// Compute all Relumi-derived data before building HTML, so we can insert
		// `nameWithTitle` (move-name wrapping with relumi-change-up / flags
		// tooltip) directly into the movenamecol span.
		let pp = (move.pp === 1 || move.noPPBoosts ? move.pp : move.pp * 8 / 5);
		if (search.dex.gen < 3) pp = Math.min(61, pp);
		if (search.dex.modid === 'champions') {
			pp = move.pp > 20 ? 20 : move.pp;
			if (!move.noPPBoosts) pp = (pp / 5 + 1) * 4;
		}

		const movePowerClass = this.getMoveChangeClass(id, 'basePower', move.basePower);
		const moveAccuracyClass = this.getMoveChangeClass(id, 'accuracy', move.accuracy);
		const movePowerDiff = this.getMoveDiff(id, 'basePower', move.basePower);
		const moveAccuracyDiff = this.getMoveDiff(id, 'accuracy', move.accuracy);
		const isNewLearnset = this.isNewRelumiLearnset(id);
		const moveNameClass = isNewLearnset ? 'relumi-change-up' : '';
		const flagsTooltip = this.getMoveFlagsTooltip(move);
		const typedSearch = this.props.search.typedSearch;
		const speciesId = typedSearch?.species || '' as ID;
		let methodCode = '';
		const showLearnsetMethods = Dex.prefs('relumiShowLearnsetMethods') !== false;
		if (speciesId && showLearnsetMethods) {
			const isRelumi = this.props.search.dex.modid === 'gen8relumi' ||
				(this.props.search.typedSearch?.format || '').includes('relumi');
			const table = isRelumi
				? (window as any).BattleTeambuilderTable?.gen8relumi
				: (window as any).BattleTeambuilderTable;
			const rawLearnsets = table?.learnsets;
			if (rawLearnsets) {
				// Walk the learnset chain so egg moves show for evolved Pokémon,
				// not just the base form.
				let cur: ID = this.getFirstLearnsetId(speciesId, rawLearnsets);
				const visited: Record<string, true> = Object.create(null);
				while (cur) {
					if (visited[cur]) break;
					visited[cur] = true;
					const learnEntry = rawLearnsets[cur]?.[id];
					if (learnEntry) {
						methodCode = learnEntry;
						break;
					}
					cur = this.getNextLearnsetId(cur, speciesId, rawLearnsets);
				}
			}
		}
		const method = this.parseMethodCode(methodCode);
		const fmtValue = (v: number | true) => v === true ? 'always' : String(v);
		type MoveDiff = { vanilla: number | true, delta: number };
		const fmtMoveTitle = (label: string, diff: MoveDiff | null, current: number | true) => {
			if (!diff) return '';
			const sign = diff.delta > 0 ? '+' : '';
			return `Vanilla ${label}: ${fmtValue(diff.vanilla)} → ${fmtValue(current)} (${sign}${diff.delta})`;
		};
		const nameWithTitle = moveNameClass || flagsTooltip
			? `<span class="${moveNameClass}${flagsTooltip ? ' has-move-flags' : ''}" title="${escapeHTML(flagsTooltip)}">${this.renderNameHTML(move.name, matchStart, matchEnd, tagStart)}</span>`
			: this.renderNameHTML(move.name, matchStart, matchEnd, tagStart);

		let buf = `<li class="result" value="${index}"><a href="${Dex.getLuminescentUrl('move', id)}" ` +
			`class="${this.moveIds.includes(id) ? 'cur' : ''}" data-target="push" data-entry="${escapeHTML(entry)}">` +
			`<span class="col movenamecol">${nameWithTitle}${method ? ` <span class="move-method-badge">${method}</span>` : ''}</span>`;

		if (errorMessage) return `${buf}${errorMessage}</a></li>`;

		buf += `<span class="col typecol">` +
			`<img src="${Dex.resourcePrefix}sprites/types/${encodeURIComponent(move.type)}.png" ` +
			`alt="${escapeHTML(move.type)}" height="14" width="32" class="pixelated" />` +
			`<img src="${Dex.resourcePrefix}sprites/categories/${escapeHTML(move.category)}.png" ` +
			`alt="${escapeHTML(move.category)}" height="14" width="32" class="pixelated" />` +
			`</span>` +
			`<span class="col labelcol" title="${fmtMoveTitle('Power', movePowerDiff, move.basePower)}">` +
			(move.category !== 'Status' ? `<em>Power</em><br /><span class="${movePowerClass}">${move.basePower || '&mdash;'}</span>` : '') +
			`</span>` +
			`<span class="col widelabelcol" title="${fmtMoveTitle('Accuracy', moveAccuracyDiff, move.accuracy)}">` +
			`<em>Accuracy</em><br /><span class="${moveAccuracyClass}">` +
			`${move.accuracy && move.accuracy !== true ? `${move.accuracy}%` : '&mdash;'}</span></span>` +
			`<span class="col pplabelcol"><em>PP</em><br />${pp}</span>` +
			`<span class="col movedesccol" data-name="${escapeHTML(move.name)}">` +
			`${this.parseDescriptionTags(move.shortDesc)}` +
			`</span>` +
			`</a></li>`;

		return buf;
	}

	renderTypeRowHTML(index: number, id: ID, matchStart: number, matchEnd: number, errorMessage?: string) {
		const name = id.charAt(0).toUpperCase() + id.slice(1);
		const urlRoot = `//${Config.routes.dex}/`;

		return `<li class="result" value="${index}"><a href="${urlRoot}types/${id}" ` +
			`data-target="push" data-entry="type|${escapeHTML(name)}">` +
			`<span class="col namecol">${this.renderNameHTML(name, matchStart, matchEnd)}</span>` +
			`<span class="col typecol"><img src="${Dex.resourcePrefix}sprites/types/${encodeURIComponent(name)}.png" ` +
			`alt="${escapeHTML(name)}" height="14" width="32" class="pixelated" /></span>` +
			(errorMessage || '') +
			`</a></li>`;
	}

	renderCategoryRowHTML(index: number, id: ID, matchStart: number, matchEnd: number, errorMessage?: string) {
		const name = id.charAt(0).toUpperCase() + id.slice(1);
		const urlRoot = `//${Config.routes.dex}/`;

		return `<li class="result" value="${index}"><a href="${urlRoot}categories/${id}" ` +
			`data-target="push" data-entry="category|${escapeHTML(name)}">` +
			`<span class="col namecol">${this.renderNameHTML(name, matchStart, matchEnd)}</span>` +
			`<span class="col typecol"><img src="${Dex.resourcePrefix}sprites/categories/${escapeHTML(name)}.png" ` +
			`alt="${escapeHTML(name)}" height="14" width="32" class="pixelated" /></span>` +
			(errorMessage || '') +
			`</a></li>`;
	}

	renderFlagRowHTML(index: number, id: ID, matchStart: number, matchEnd: number) {
		const name = id.charAt(0).toUpperCase() + id.slice(1);
		return `<li class="result" value="${index}"><a href="#" data-target="push" data-entry="flag|${id}">` +
			`<span class="col namecol">${this.renderNameHTML(name, matchStart, matchEnd)}</span>` +
			`<span class="col movedesccol">(flag)</span>` +
			`</a></li>`;
	}

	renderArticleRowHTML(index: number, id: ID, matchStart: number, matchEnd: number, errorMessage?: string) {
		const isSearchType = (id === 'pokemon' || id === 'moves');
		const name = window.BattleArticleTitles?.[id] || (id.charAt(0).toUpperCase() + id.substr(1));
		const urlRoot = `//${Config.routes.dex}/`;

		return `<li class="result" value="${index}"><a href="${urlRoot}articles/${id}" ` +
			`data-target="push" data-entry="article|${escapeHTML(name)}">` +
			`<span class="col namecol">${this.renderNameHTML(name, matchStart, matchEnd)}</span>` +
			`<span class="col movedesccol">${isSearchType ? "(search type)" : "(article)"}</span>` +
			(errorMessage || '') +
			`</a></li>`;
	}

	renderEggGroupRowHTML(index: number, id: ID, matchStart: number, matchEnd: number, errorMessage?: string) {
		// very hardcode
		let name: string | undefined;
		if (id === 'humanlike') name = 'Human-Like';
		else if (id === 'water1') name = 'Water 1';
		else if (id === 'water2') name = 'Water 2';
		else if (id === 'water3') name = 'Water 3';
		if (name) {
			if (matchEnd > 5) matchEnd++;
		} else {
			name = id.charAt(0).toUpperCase() + id.slice(1);
		}
		const urlRoot = `//${Config.routes.dex}/`;

		return `<li class="result" value="${index}"><a href="${urlRoot}egggroups/${id}" ` +
			`data-target="push" data-entry="egggroup|${escapeHTML(name)}">` +
			`<span class="col namecol">${this.renderNameHTML(name, matchStart, matchEnd)}</span>` +
			`<span class="col movedesccol">(egg group)</span>` +
			(errorMessage || '') +
			`</a></li>`;
	}

	renderTierRowHTML(index: number, id: ID, matchStart: number, matchEnd: number, errorMessage?: string) {
		// very hardcode
		const tierTable: { [id: string]: string } = {
			uber: "Uber",
			caplc: "CAP LC",
			capnfe: "CAP NFE",
		};
		const name = tierTable[id] || id.toUpperCase();
		const urlRoot = `//${Config.routes.dex}/`;

		return `<li class="result" value="${index}"><a href="${urlRoot}tiers/${id}" ` +
			`data-target="push" data-entry="tier|${escapeHTML(name)}">` +
			`<span class="col namecol">${this.renderNameHTML(name, matchStart, matchEnd)}</span>` +
			`<span class="col movedesccol">(tier)</span>` +
			(errorMessage || '') +
			`</a></li>`;
	}

	renderRowHTML(row: SearchRow, index: number) {
		const search = this.props.search;
		const [type, id] = row;
		let matchStart = 0;
		let matchEnd = 0;
		if (row.length > 3) {
			matchStart = row[2]!;
			matchEnd = row[3]!;
		}

		let errorMessage = '';
		let label;
		if ((label = search.filterLabel(type))) {
			errorMessage = `<span class="col filtercol"><em>${escapeHTML(label)}</em></span>`;
		} else if ((label = search.illegalLabel(id as ID))) {
			errorMessage = `<span class="col illegalcol"><em>${escapeHTML(label)}</em></span>`;
		}

		switch (type) {
		case 'html':
			const sanitizedHTML = escapeHTML(id)
				.replace(/&lt;em&gt;/g, '<em>').replace(/&lt;\/em&gt;/g, '</em>')
				.replace(/&lt;strong&gt;/g, '<strong>').replace(/&lt;\/strong&gt;/g, '</strong>');
			return `<li class="result" value="${index}"><p>${sanitizedHTML}</p></li>`;
		case 'header':
			return `<li class="result" value="${index}"><h3>${escapeHTML(id)}</h3></li>`;
		case 'sortpokemon':
			return this.renderPokemonSortRowHTML(index);
		case 'sortmove':
			return this.renderMoveSortRowHTML(index);
		case 'pokemon':
			return this.renderPokemonRowHTML(index, id, matchStart, matchEnd, errorMessage);
		case 'move':
			return this.renderMoveRowHTML(index, id, matchStart, matchEnd, errorMessage);
		case 'item':
			return this.renderItemRowHTML(index, id, matchStart, matchEnd, errorMessage);
		case 'ability':
			return this.renderAbilityRowHTML(index, id, matchStart, matchEnd, errorMessage);
		case 'type':
			return this.renderTypeRowHTML(index, id, matchStart, matchEnd, errorMessage);
		case 'egggroup':
			return this.renderEggGroupRowHTML(index, id, matchStart, matchEnd, errorMessage);
		case 'tier':
			return this.renderTierRowHTML(index, id, matchStart, matchEnd, errorMessage);
		case 'category':
			return this.renderCategoryRowHTML(index, id, matchStart, matchEnd, errorMessage);
		case 'article':
			return this.renderArticleRowHTML(index, id, matchStart, matchEnd, errorMessage);
		case 'flag':
			return this.renderFlagRowHTML(index, id, matchStart, matchEnd);
		}
		return `<li>Error: not found</li>`;
	}

	static renderFilters(search: DexSearch, showHints?: boolean) {
		return search.filters && <li class="dexlist-filters">
			{showHints && "Filters: "}
			{search.filters.map(([type, name]) =>
				<button class="filter" data-filter={`${type}:${name}`}>
					{name} <i class="fa fa-times-circle" aria-hidden></i>
				</button>
			)}
			{!search.query && showHints && <small style="color: #888">(backspace = delete filter)</small>}
		</li>;
	}

	static renderFiltersHTML(search: DexSearch, showHints?: boolean) {
		if (!search.filters) return '';
		return `<li class="dexlist-filters">` +
			(showHints ? `Filters: ` : ``) +
			search.filters.map(([type, name]) =>
				`<button class="filter" data-filter="${escapeHTML(type)}:${escapeHTML(name)}">` +
				`${escapeHTML(name)} <i class="fa fa-times-circle" aria-hidden></i></button>`
			).join('') +
			(!search.query && showHints ? `<small style="color: #888">(backspace = delete filter)</small>` : ``) +
			`</li>`;
	}

	renderPagerHTML(direction: -1 | 1) {
		const label = direction < 0 ? 'Show previous search results' : 'Show next search results';
		return `<li class="result resultpage"><button class="button" data-page="${direction}">${label}</button></li>`;
	}

	handleClick = (ev: Event) => {
		const search = this.props.search;
		let target = ev.target as HTMLElement | null;
		while (target && target.className !== 'dexlist') {
			if (target.tagName === 'A') {
				const entry = target.getAttribute('data-entry');
				if (entry) {
					const [type, name, slot] = entry.split('|');
					if (search.addFilter([type, name])) {
						if (this.props.onSelect) {
							this.props.onSelect?.('', '');
						} else if (search.query) {
							search.find('');
							this.forceUpdate();
						}
					} else {
						this.props.onSelect?.(type as SearchType, name, slot);
					}
					ev.preventDefault();
					ev.stopImmediatePropagation();
					break;
				}
			}
			if (target.tagName === 'BUTTON') {
				const page = target.getAttribute('data-page');
				if (page) {
					this.pageResults(parseInt(page) as -1 | 1);
					ev.preventDefault();
					ev.stopPropagation();
					break;
				}

				const filter = target.getAttribute('data-filter');
				if (filter) {
					search.removeFilter(filter.split(':') as any);
					search.find('');
					ev.preventDefault();
					ev.stopPropagation();
					this.props.onSelect?.(null, '');
					break;
				}

				// sort
				const sort = target.getAttribute('data-sort');
				if (sort) {
					search.toggleSort(sort);
					search.find('');
					ev.preventDefault();
					ev.stopPropagation();
					this.props.onSelect?.(null, '');
					break;
				}
			}

			target = target.parentElement;
		}
	};

	handleMouseDown = (ev: MouseEvent) => {
		// bypass blur handlers, so the buttons don't get re-rendered before the click
		// handler can run
		let target = ev.target as HTMLElement | null;
		while (target && target.className !== 'dexlist') {
			if (target.tagName === 'A') {
				ev.preventDefault();
				return;
			}
			if (target.tagName === 'BUTTON' && (target.hasAttribute('data-filter') || target.hasAttribute('data-sort'))) {
				ev.preventDefault();
				return;
			}
			target = target.parentElement;
		}
	};

	handleScroll = () => {
		if (this.base?.scrollTop && document.documentElement.clientWidth === document.documentElement.scrollWidth) {
			(this.base as any).scrollIntoViewIfNeeded?.();
		}
		if (this.scrollFrame) return;
		this.scrollFrame = requestAnimationFrame(() => {
			this.scrollFrame = 0;
			this.updateDOM(false);
		});
	};

	updateCurrentSet() {
		const search = this.props.search;
		const set = search.typedSearch?.set;
		if (set) {
			this.speciesId = toID(set.species);
			this.itemId = toID(set.item);
			this.abilityId = toID(set.ability);
			this.moveIds = set.moves.map(toID);
		} else {
			this.speciesId = '' as ID;
			this.itemId = '' as ID;
			this.abilityId = '' as ID;
			this.moveIds = [];
		}
	}

	updateSelection() {
		const list = this.base?.querySelector<HTMLElement>('.dexlist') || null;
		if (!list) return;
		list.querySelector('[aria-selected]')?.removeAttribute('aria-selected');
		list.querySelector(`li.result[value="${this.props.search.selection}"] > a`)?.setAttribute('aria-selected', 'true');
	}

	getFocusedListSelector(list: HTMLElement) {
		const active = document.activeElement as HTMLElement | null;
		if (!active || !list.contains?.(active)) return null;
		const filter = active.getAttribute('data-filter');
		if (filter !== null) return `button[data-filter="${escapeCSSString(filter)}"]`;
		const sort = active.getAttribute('data-sort');
		const li = active.closest<HTMLLIElement>('li.result');
		if (sort !== null && li) {
			return `li.result[value="${li.value}"] button[data-sort="${escapeCSSString(sort)}"]`;
		}
		if (active.tagName === 'A' && li) return `li.result[value="${li.value}"] > a`;
		return null;
	}

	restoreFocusedListElement(list: HTMLElement, selector: string | null) {
		if (!selector) return;
		const target = list.querySelector<HTMLElement>(selector);
		if (!target || document.activeElement === target) return;
		const scrollTop = this.base?.scrollTop;
		target.focus();
		if (this.base && scrollTop !== undefined) this.base.scrollTop = scrollTop;
	}

	focusResult(list: HTMLElement, index: number) {
		const target = list.querySelector<HTMLElement>(`li.result[value="${index}"] > a`);
		if (!target) return;
		const scrollTop = this.base?.scrollTop;
		target.focus();
		if (this.base && scrollTop !== undefined) this.base.scrollTop = scrollTop;
	}

	pageResults(direction: -1 | 1) {
		if (!this.base) return;
		const results = this.props.search.results || [];
		if (!results.length) return;
		const viewRows = Math.max(1, Math.ceil(this.base.clientHeight / RESULT_ROW_HEIGHT));
		const targetIndex = Math.max(0, Math.min(
			results.length - 1,
			direction > 0 ? this.renderedEnd : this.renderedStart - 1
		));
		this.base.scrollTop = direction > 0 ?
			targetIndex * RESULT_ROW_HEIGHT :
			Math.max(0, (targetIndex - viewRows + 1) * RESULT_ROW_HEIGHT);
		this.updateDOM(true, targetIndex);
	}

	scrollSelectedResult() {
		if (!this.base) return;
		this.base.scrollTop = Math.max(
			0,
			this.props.search.selection * RESULT_ROW_HEIGHT - Math.trunc(this.base.clientHeight * 2 / 5)
		);
		this.updateDOM(true);
	}

	updateDOM(force = true, focusIndex = -1) {
		// Invalidate per-search memos so Relumi diff lookups don't return stale
		// data when the search dex or current species changes between renders.
		this._relumi.clearCache();
		this._relumiHighlightCached = undefined;

		const list = this.base?.querySelector<HTMLElement>('.dexlist') || null;
		if (!list) return;
		const search = this.props.search;
		const results = search.results || [];
		const scrollTop = this.base?.scrollTop || 0;
		const viewHeight = this.base?.clientHeight || window.innerHeight;
		const visibleStart = Math.max(0, Math.floor(scrollTop / RESULT_ROW_HEIGHT));
		const visibleEnd = Math.min(results.length, Math.ceil((scrollTop + viewHeight) / RESULT_ROW_HEIGHT));
		const hasEnoughRowsAbove = (
			this.renderedStart === 0 || visibleStart >= this.renderedStart + RESULT_REFILL_THRESHOLD_ROWS
		);
		const hasEnoughRowsBelow = (
			this.renderedEnd === results.length || visibleEnd <= this.renderedEnd - RESULT_REFILL_THRESHOLD_ROWS
		);
		if (
			!force && results.length === this.renderedLength &&
			hasEnoughRowsAbove && hasEnoughRowsBelow
		) {
			this.updateSelection();
			return;
		}
		const start = Math.max(0, visibleStart - RESULT_OVERSCAN_ROWS);
		const end = Math.min(results.length, visibleEnd + RESULT_OVERSCAN_ROWS);
		this.renderedStart = start;
		this.renderedEnd = end;
		this.renderedLength = results.length;
		const hasPrevPage = start > 0;
		const hasNextPage = end < results.length;
		const topSpacer = (start - (hasPrevPage ? 1 : 0)) * RESULT_ROW_HEIGHT;
		const bottomSpacer = (results.length - end - (hasNextPage ? 1 : 0)) * RESULT_ROW_HEIGHT;

		this.updateCurrentSet();

		let html = '';
		if (!this.props.hideFilters) html += PSSearchResults.renderFiltersHTML(search, true);
		if (topSpacer) html += `<li aria-hidden="true" style="height:${topSpacer}px"></li>`;
		if (hasPrevPage) html += this.renderPagerHTML(-1);
		for (let i = start; i < end; i++) {
			html += this.renderRowHTML(results[i], i);
		}
		if (hasNextPage) html += this.renderPagerHTML(1);
		if (bottomSpacer) html += `<li aria-hidden="true" style="height:${bottomSpacer}px"></li>`;
		const selector = this.getFocusedListSelector(list);
		list.innerHTML = html;
		this.updateSelection();
		if (focusIndex >= 0) {
			this.focusResult(list, focusIndex);
		} else {
			this.restoreFocusedListElement(list, selector);
		}
	}

	override componentDidUpdate() {
		this.updateDOM(true);
	}

	override componentDidMount() {
		this.base?.addEventListener('scroll', this.handleScroll);
		this.props.search.resultsComponent = this;
		this.updateDOM(true);
	}

	override componentWillUnmount() {
		this.base?.removeEventListener('scroll', this.handleScroll);
		this.props.search.resultsComponent = null;
		if (this.scrollFrame) cancelAnimationFrame(this.scrollFrame);
	}

	override render() {
		// the <ul> contents are uncontrolled
		return <div class={this.props.class} style={this.props.style}>
			{this.props.prepend}
			<ul class="dexlist" onMouseDown={this.handleMouseDown} onClick={this.handleClick}></ul>
			{this.props.children}
		</div>;
	}
}
