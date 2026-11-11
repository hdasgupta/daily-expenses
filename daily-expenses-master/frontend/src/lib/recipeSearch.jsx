/**
 * High-performance, intelligent recipe indexing and search engine.
 * Pre-indexes recipe tokens for sub-millisecond multi-token search,
 * semantic relevance scoring, and category filtering.
 */

export function indexRecipes(recipes = []) {
  if (!Array.isArray(recipes)) return [];
  return recipes.map((recipe) => {
    const nameLower = String(recipe?.name || "").toLowerCase().trim();
    const categoryLower = String(recipe?.category || "").toLowerCase().trim();
    const regionLower = String(recipe?.region || "").toLowerCase().trim();
    const ingredients = Array.isArray(recipe?.ingredients) ? recipe.ingredients : [];
    const ingredientNames = ingredients.map((i) => String(i?.name || "").toLowerCase().trim()).filter(Boolean);
    const ingredientsText = ingredientNames.join(" ");
    const combinedText = `${nameLower} ${categoryLower} ${regionLower} ${ingredientsText}`;
    const prepMinutes = Number(recipe?.prepMinutes) || 0;
    const cookMinutes = Number(recipe?.cookMinutes) || 0;

    return {
      ...recipe,
      _nameLower: nameLower,
      _categoryLower: categoryLower,
      _regionLower: regionLower,
      _ingredientsText: ingredientsText,
      _combinedText: combinedText,
      _totalMinutes: prepMinutes + cookMinutes,
      _ingredientCount: ingredients.length,
    };
  });
}

export function extractCategories(recipes = []) {
  const set = new Set();
  for (const r of recipes) {
    if (r?.category && String(r.category).trim()) {
      set.add(String(r.category).trim());
    }
  }
  return ["All", ...Array.from(set).sort((a, b) => a.localeCompare(b))];
}

export function searchAndRankRecipes(indexedRecipes = [], options = {}) {
  const {
    query = "",
    category = "All",
    sortColumn = "usageCount",
    sortDirection = "desc",
    getUsageCount = null,
  } = options;

  const rawQuery = String(query || "").trim();
  const qLower = rawQuery.toLowerCase();
  const tokens = qLower.split(/\s+/).filter(Boolean);
  const activeCategory = String(category || "All").trim();
  const isCategoryFilterActive = activeCategory && activeCategory !== "All";
  const catLower = activeCategory.toLowerCase();

  const matches = [];

  for (let i = 0; i < indexedRecipes.length; i++) {
    const r = indexedRecipes[i];

    if (isCategoryFilterActive && r._categoryLower !== catLower) {
      continue;
    }

    if (!tokens.length) {
      matches.push({ recipe: r, score: 0 });
      continue;
    }

    let allTokensPresent = true;
    for (let j = 0; j < tokens.length; j++) {
      if (!r._combinedText.includes(tokens[j])) {
        allTokensPresent = false;
        break;
      }
    }

    if (!allTokensPresent) {
      continue;
    }

    let score = 0;

    if (r._nameLower === qLower) {
      score += 1000;
    } else if (r._nameLower.includes(qLower)) {
      score += 700;
    } else if (tokens.length && r._nameLower.startsWith(tokens[0])) {
      score += 500;
    } else {
      let tokensInName = 0;
      for (let j = 0; j < tokens.length; j++) {
        if (r._nameLower.includes(tokens[j])) {
          tokensInName++;
        }
      }
      if (tokensInName === tokens.length) {
        score += 350;
      } else if (tokensInName > 0) {
        score += 150 + tokensInName * 30;
      }
    }

    if (r._categoryLower === qLower || r._regionLower === qLower) {
      score += 250;
    } else if (r._categoryLower.includes(qLower) || r._regionLower.includes(qLower)) {
      score += 80;
    }

    if (r._ingredientsText.includes(qLower)) {
      score += 60;
    }

    if (r._nameLower.length > 0 && r._nameLower.includes(qLower)) {
      score += Math.max(0, 50 - Math.floor(r._nameLower.length / 2));
    }

    matches.push({ recipe: r, score });
  }

  const dirMultiplier = sortDirection === "desc" ? -1 : 1;

  matches.sort((a, b) => {
    if (tokens.length > 0 && (!sortColumn || sortColumn === "usageCount")) {
      const scoreDiff = b.score - a.score;
      if (scoreDiff !== 0) return scoreDiff;
    }

    if (!sortColumn || sortColumn === "usageCount") {
      const aUsage = getUsageCount ? getUsageCount(a.recipe) : Number(a.recipe.usageCount || 0);
      const bUsage = getUsageCount ? getUsageCount(b.recipe) : Number(b.recipe.usageCount || 0);
      const usageDiff = bUsage - aUsage;
      const effectiveDiff = sortDirection === "asc" ? -usageDiff : usageDiff;
      if (effectiveDiff !== 0) return effectiveDiff;

      const aUser = Number(a.recipe.userUsageCount || 0);
      const bUser = Number(b.recipe.userUsageCount || 0);
      const userDiff = bUser - aUser;
      const effectiveUserDiff = sortDirection === "asc" ? -userDiff : userDiff;
      if (effectiveUserDiff !== 0) return effectiveUserDiff;
    }

    if (sortColumn === "name") {
      return dirMultiplier * a.recipe.name.localeCompare(b.recipe.name);
    }
    if (sortColumn === "totalTime") {
      const timeDiff = a.recipe._totalMinutes - b.recipe._totalMinutes;
      if (timeDiff !== 0) return dirMultiplier * timeDiff;
    }
    if (sortColumn === "ingredientCount") {
      const countDiff = a.recipe._ingredientCount - b.recipe._ingredientCount;
      if (countDiff !== 0) return dirMultiplier * countDiff;
    }

    return String(a.recipe.name || "").localeCompare(String(b.recipe.name || ""));
  });

  return matches.map((m) => m.recipe);
}
