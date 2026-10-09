// Available in every target runtime (browsers, Node ≥ 17, workers). Declared
// here because the engine compiles without DOM or Node typings.
declare function structuredClone<T>(value: T): T;
