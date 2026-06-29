/**
 * Relumi diff helpers
 *
 * Shared logic for highlighting balance changes between Relumi and vanilla
 * Pokémon Showdown. Used by both battle tooltips (in-battle stat/ability
 * highlighting) and search results (teambuilder stat/ability/move diff
 * columns). Each consumer instantiates its own helper so the per-render
 * memo cache stays scoped to the component lifecycle.
 *
 * @license MIT
 */

import { Dex, type ModdedDex, toID, type ID } from "./battle-dex";

export interface RelumiDiffOptions {
	/** Returns the Dex for resolving species/moves for this consumer. */
	getDex: () => ModdedDex;
	/**
	 * Returns true when relumi balance-change highlighting should be active.
	 * Each consumer owns the prefs key + format check it wants to honor.
	 */
	shouldHighlight: () => boolean;
}

export class RelumiDiffHelper {
	// Per-instance memoization shared across all helper methods.
	private _cache: Record<string, any> = Object.create(null);
	private readonly options: RelumiDiffOptions;

	constructor(options: RelumiDiffOptions) {
		this.options = options;
	}

	/** Drop all memoized lookups; consumers call this between render passes. */
	clearCache() {
		for (const k in this._cache) delete this._cache[k];
	}

	/** True when balance-change highlighting is currently active. */
	shouldHighlightRelumiChanges(): boolean {
		return this.options.shouldHighlight();
	}

	// Cache helpers for consumers (e.g. species-internal BST diff caching) that
	// want to share the same memoization key-space as the built-in helpers.
	cacheHas(key: string): boolean { return key in this._cache; }
	cacheGet<T = any>(key: string): T { return this._cache[key]; }
	cacheSet(key: string, value: any): void { this._cache[key] = value; }

	getRelumiOverrides() {
		return (window as any).BattleTeambuilderTable?.gen8relumi || null;
	}

	resolveBaseSpeciesId(speciesId: ID): ID {
		const species = this.options.getDex().species.get(speciesId);
		if (!species?.exists) return '' as ID;
		const baseId = toID(species.baseSpecies || speciesId);
		return baseId !== speciesId ? baseId : speciesId;
	}

	formsShareBaseStats(formStats: Dex.StatsTable, baseStats: Dex.StatsTable): boolean {
		if (!formStats || !baseStats) return false;
		return formStats.hp === baseStats.hp && formStats.atk === baseStats.atk &&
			formStats.def === baseStats.def && formStats.spa === baseStats.spa &&
			formStats.spd === baseStats.spd && formStats.spe === baseStats.spe;
	}

	getRelumiDiffSourceSpeciesId(speciesId: ID): ID {
		const cacheKey = 'diffSource|' + speciesId;
		if (cacheKey in this._cache) return this._cache[cacheKey];
		const relumiTable = this.getRelumiOverrides();
		let result: ID = speciesId;
		if (relumiTable?.overrideSpeciesData) {
			if (relumiTable.overrideSpeciesData[speciesId]) {
				result = speciesId;
			} else {
				// Fall back to base form only if base has overrides AND this form is
				// effectively the same as base (custom form, or cosmetic form with
				// identical vanilla stats to base).
				const baseId = this.resolveBaseSpeciesId(speciesId);
				if (baseId && baseId !== speciesId && relumiTable.overrideSpeciesData[baseId]) {
					const vanillaSpecies = Dex.forGen(9).species.get(speciesId);
					if (!vanillaSpecies.exists) {
						result = baseId;
					} else {
						const vanillaBase = Dex.forGen(9).species.get(baseId);
						if (vanillaBase?.exists &&
							!this.formsShareBaseStats(vanillaSpecies.baseStats, vanillaBase.baseStats)) {
							// Vanilla stats differ from base = form has its own stats
							// (e.g. Rotom appliances); do not coalesce.
							result = speciesId;
						} else {
							result = baseId;
						}
					}
				} else {
					result = speciesId;
				}
			}
		}
		this._cache[cacheKey] = result;
		return result;
	}

	getVanillaComparisonSpeciesId(speciesId: ID): ID {
		const cacheKey = 'vanillaCmp|' + speciesId;
		if (cacheKey in this._cache) return this._cache[cacheKey];
		const relumiTable = this.getRelumiOverrides();
		const hasVanillaData = !!(relumiTable?.vanillaSpeciesData && speciesId in relumiTable.vanillaSpeciesData);
		let result: ID;
		if (hasVanillaData) {
			result = speciesId;
		} else if (relumiTable?.overrideSpeciesData && speciesId in relumiTable.overrideSpeciesData) {
			// Custom form (override, no vanilla snapshot) — fall back to base form.
			result = this.resolveBaseSpeciesId(speciesId) || speciesId;
		} else {
			const vanillaSpecies = Dex.forGen(9).species.get(speciesId);
			if (vanillaSpecies.exists) {
				result = speciesId;
			} else {
				result = this.resolveBaseSpeciesId(speciesId) || speciesId;
			}
		}
		this._cache[cacheKey] = result;
		return result;
	}

	getVanillaSpeciesData(speciesId: ID): Dex.Species | null {
		const cacheKey = 'vanillaSpecies|' + speciesId;
		if (cacheKey in this._cache) return this._cache[cacheKey];
		const relumiTable = this.getRelumiOverrides();
		let result: Dex.Species | null;
		if (relumiTable?.vanillaSpeciesData?.[speciesId]) {
			result = relumiTable.vanillaSpeciesData[speciesId];
		} else if (relumiTable?.overrideSpeciesData && speciesId in relumiTable.overrideSpeciesData) {
			// Custom form (override present, no vanilla snapshot) — Dex.forGen would
			// return the mod-added BattlePokedex entry, not true vanilla data.
			result = null;
		} else {
			const vanillaSpecies = Dex.forGen(9).species.get(speciesId);
			result = vanillaSpecies.exists ? vanillaSpecies : null;
		}
		this._cache[cacheKey] = result;
		return result;
	}

	getVanillaMoveData(moveId: ID): Dex.Move | null {
		const cacheKey = 'vanillaMove|' + moveId;
		if (cacheKey in this._cache) return this._cache[cacheKey];
		const relumiTable = this.getRelumiOverrides();
		let result: Dex.Move | null;
		if (relumiTable?.vanillaMoveData?.[moveId]) {
			result = relumiTable.vanillaMoveData[moveId];
		} else {
			const vanillaMove = Dex.forGen(9).moves.get(moveId);
			result = vanillaMove.exists ? vanillaMove : null;
		}
		this._cache[cacheKey] = result;
		return result;
	}

	getStatDiff(speciesId: ID, statName: Dex.StatName, value: number): { vanilla: number, delta: number } | null {
		const cacheKey = `statDiff|${speciesId}|${statName}|${value}`;
		if (cacheKey in this._cache) return this._cache[cacheKey];
		let result: { vanilla: number, delta: number } | null = null;
		if (!this.options.shouldHighlight()) {
			this._cache[cacheKey] = result;
			return result;
		}
		const relumiTable = this.getRelumiOverrides();
		if (!relumiTable?.overrideSpeciesData) {
			this._cache[cacheKey] = result;
			return result;
		}
		const diffSourceId = this.getRelumiDiffSourceSpeciesId(speciesId);
		const relumiSpeciesDiff = relumiTable.overrideSpeciesData[diffSourceId];
		if (!relumiSpeciesDiff) {
			this._cache[cacheKey] = result;
			return result;
		}

		let vanillaComparisonId: ID;
		let vanillaSpecies: Dex.Species | null;
		if (relumiSpeciesDiff.baseStats?.[statName] !== undefined) {
			vanillaComparisonId = this.getVanillaComparisonSpeciesId(diffSourceId);
			vanillaSpecies = this.getVanillaSpeciesData(vanillaComparisonId);
			if (!vanillaSpecies) {
				this._cache[cacheKey] = result;
				return result;
			}
		} else if (!relumiSpeciesDiff.baseStats) {
			if (this.getVanillaSpeciesData(speciesId)) {
				this._cache[cacheKey] = result;
				return result;
			}
			vanillaComparisonId = this.getVanillaComparisonSpeciesId(speciesId);
			vanillaSpecies = this.getVanillaSpeciesData(vanillaComparisonId);
			if (!vanillaSpecies?.baseStats) {
				this._cache[cacheKey] = result;
				return result;
			}
		} else {
			this._cache[cacheKey] = result;
			return result;
		}

		const vanillaStat = vanillaSpecies.baseStats[statName];
		if (typeof vanillaStat !== 'number' || vanillaStat === value) {
			this._cache[cacheKey] = result;
			return result;
		}
		result = { vanilla: vanillaStat, delta: value - vanillaStat };
		this._cache[cacheKey] = result;
		return result;
	}

	getStatClass(speciesId: ID, statName: Dex.StatName, value: number) {
		const diff = this.getStatDiff(speciesId, statName, value);
		if (!diff) return '';
		return diff.delta > 0 ? 'relumi-change-up' : 'relumi-change-down';
	}

	isNewRelumiAbility(speciesId: ID, abilityName: string): boolean {
		if (!abilityName) return false;
		const cacheKey = 'newAbility|' + speciesId + '|' + abilityName;
		if (cacheKey in this._cache) return this._cache[cacheKey];
		let result = false;
		if (!this.options.shouldHighlight()) {
			this._cache[cacheKey] = result;
			return result;
		}
		const relumiTable = this.getRelumiOverrides();
		if (!relumiTable?.overrideSpeciesData) {
			this._cache[cacheKey] = result;
			return result;
		}
		const diffSourceId = this.getRelumiDiffSourceSpeciesId(speciesId);
		const relumiSpeciesDiff = relumiTable.overrideSpeciesData[diffSourceId];
		if (!relumiSpeciesDiff) {
			this._cache[cacheKey] = result;
			return result;
		}

		let vanillaComparisonId: ID;
		let vanillaSpecies: Dex.Species | null;
		if (relumiSpeciesDiff.abilities) {
			// Normal path: override has abilities.
			vanillaComparisonId = this.getVanillaComparisonSpeciesId(diffSourceId);
			vanillaSpecies = this.getVanillaSpeciesData(vanillaComparisonId);
			if (!vanillaSpecies) {
				this._cache[cacheKey] = result;
				return result;
			}
		} else {
			// No abilities override — custom form path: compare against base form's
			// vanilla abilities.
			if (this.getVanillaSpeciesData(speciesId)) {
				this._cache[cacheKey] = result;
				return result;
			}
			vanillaComparisonId = this.getVanillaComparisonSpeciesId(speciesId);
			vanillaSpecies = this.getVanillaSpeciesData(vanillaComparisonId);
			if (!vanillaSpecies) {
				this._cache[cacheKey] = result;
				return result;
			}
		}

		const vanillaAbilities: Record<string, true> = Object.create(null);
		for (const slot in vanillaSpecies.abilities) {
			const vanillaAbilityName = vanillaSpecies.abilities[slot as '0' | '1' | 'H' | 'S'];
			if (vanillaAbilityName) vanillaAbilities[vanillaAbilityName] = true;
		}
		result = !vanillaAbilities[abilityName];
		this._cache[cacheKey] = result;
		return result;
	}
}
