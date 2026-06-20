/**
 * Re-Ranking Service
 *
 * Combines Pinecone's vector similarity score with keyword overlap
 * to produce a weighted re-rank score for better retrieval quality.
 *
 * Formula: rerankScore = (pineconeScore * VECTOR_WEIGHT) + (keywordScore * KEYWORD_WEIGHT)
 */

// ----- Configurable Weights -----
const VECTOR_WEIGHT = 0.7;
const KEYWORD_WEIGHT = 0.3;
const MIN_WORD_LENGTH = 3; // ignore short stop-words

/**
 * Re-rank an array of Pinecone matches using keyword overlap with the query.
 *
 * @param {Array}  matches     - Deduplicated Pinecone match objects (must have .score and .metadata.text)
 * @param {string} searchQuery - The search query used for keyword matching
 * @returns {Array} Re-ranked matches sorted by rerankScore (descending), each enriched with rerankScore & keywordMatches
 */
export const rerankMatches = (matches, searchQuery) => {
  if (!matches || matches.length === 0) {
    return [];
  }

  // 1. Extract meaningful keywords from the query
  const queryWords = searchQuery
    .toLowerCase()
    .split(/\s+/)
    .filter(word => word.length >= MIN_WORD_LENGTH);

  // 2. Score each match
  const rerankedMatches = matches.map(match => {
    const text = (match.metadata?.text ?? '').toLowerCase();

    // Count how many query keywords appear in the chunk text
    let keywordMatchCount = 0;
    queryWords.forEach(word => {
      if (text.includes(word)) {
        keywordMatchCount++;
      }
    });

    // Keyword score: fraction of query words found (0 to 1)
    const keywordScore = queryWords.length > 0
      ? keywordMatchCount / queryWords.length
      : 0;

    // Weighted combination of vector similarity + keyword overlap
    const rerankScore =
      (match.score * VECTOR_WEIGHT) +
      (keywordScore * KEYWORD_WEIGHT);

    return {
      ...match,
      rerankScore,
      keywordMatches: keywordMatchCount,
    };
  });

  // 3. Sort by re-rank score (highest first)
  rerankedMatches.sort((a, b) => b.rerankScore - a.rerankScore);

  return rerankedMatches;
};

/**
 * Build context string from re-ranked matches.
 * Takes the top N matches, sorts them by chunkIndex for reading cohesion,
 * then joins their text.
 *
 * @param {Array}  rerankedMatches - Output from rerankMatches()
 * @param {number} [topK=7]       - Number of top matches to include
 * @returns {string} Concatenated context text
 */
export const buildContext = (rerankedMatches, topK = 7) => {
  if (!rerankedMatches || rerankedMatches.length === 0) {
    return '';
  }

  return rerankedMatches
    .slice(0, topK)
    .sort((a, b) => (a.metadata?.chunkIndex ?? 0) - (b.metadata?.chunkIndex ?? 0))
    .map(match => match.metadata?.text ?? '')
    .join("\n\n");
};

/**
 * Log re-ranking results to the console for debugging.
 *
 * @param {Array} matchesBefore - Original matches (before re-ranking)
 * @param {Array} matchesAfter  - Re-ranked matches (after re-ranking)
 */
export const logRerankResults = (matchesBefore, matchesAfter) => {
  console.log("\n========== BEFORE RE-RANK ==========");
  matchesBefore.forEach((match, index) => {
    console.log(
      `${index + 1}. Pinecone Score: ${match.score?.toFixed(4) ?? 'N/A'}`
    );
  });

  console.log("\n========== AFTER RE-RANK ==========");
  matchesAfter.forEach((match, index) => {
    console.log(
      `${index + 1}. ReRank Score: ${match.rerankScore.toFixed(4)} | Keywords: ${match.keywordMatches}`
    );
  });
};
