// ===========================================================================
// Analyzer Interface — all analyzers implement this contract
//
// Pluggable design: a new analyzer only needs to implement the interface and
// be registered in the ANALYZERS array. The AnalyzerPipeline handles dispatch.
// ===========================================================================

/**
 * @typedef {Object} AnalyzerContext
 * @property {string} command — current command name (for phase output)
 */

/**
 * Base analyzer class. Subclasses override supports() and analyze().
 */
class BaseAnalyzer {
  /** Analyzer id, e.g. "discovery" */
  get id() {
    throw new Error("Analyzer must define id");
  }

  /**
   * Return true if this analyzer applies to the given repository.
   * Override to gate analyzers by manifest language, file existence, etc.
   */
  supports(_ctx) {
    return true;
  }

  /**
   * Run analysis and write results into the evidence store.
   * @param {RepositoryContext} ctx
   * @param {Record<string, unknown>} store — evidence store object
   * @param {AnalyzerContext} analyzerCtx
   */
  async analyze(_ctx, _store, _analyzerCtx) {
    throw new Error(`Analyzer ${_ctx?.id} must implement analyze()`);
  }
}

export { BaseAnalyzer };
