// Measures how well the model's diagnosis matched the synthetic ground truth
// (`trueCategory` on each payment, set in syntheticData.js). A few decline
// messages are deliberately tagged 'ambiguous' — there's no single correct
// category by design — so those are excluded from the accuracy score, but
// what the model actually did with them is still reported for transparency.
export function evaluateClassifications(results) {
  const scorable = results.filter((r) => r.trueCategory !== 'ambiguous');
  const correct = scorable.filter((r) => r.predictedCategory === r.trueCategory);

  const confusionMatrix = {};
  for (const r of scorable) {
    confusionMatrix[r.trueCategory] ??= {};
    confusionMatrix[r.trueCategory][r.predictedCategory] =
      (confusionMatrix[r.trueCategory][r.predictedCategory] || 0) + 1;
  }

  const ambiguousBreakdown = {};
  for (const r of results.filter((r) => r.trueCategory === 'ambiguous')) {
    ambiguousBreakdown[r.predictedCategory] = (ambiguousBreakdown[r.predictedCategory] || 0) + 1;
  }

  return {
    scorableCount: scorable.length,
    correctCount: correct.length,
    accuracyPct: scorable.length ? Math.round((correct.length / scorable.length) * 1000) / 10 : null,
    confusionMatrix,
    ambiguousCount: results.length - scorable.length,
    ambiguousBreakdown
  };
}
