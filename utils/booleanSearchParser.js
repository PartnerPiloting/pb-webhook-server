/**
 * Boolean Search Parser
 * 
 * Parses search query strings with boolean operators into filter conditions
 * 
 * Supported syntax:
 * - AND (implicit with spaces or explicit): "term1 term2" or "term1 AND term2"
 * - OR: "term1 OR term2"
 * - NOT / -: "NOT term" or "-term"
 * - Parentheses: "(term1 OR term2) AND term3"
 * - Quotes: "exact phrase"
 * 
 * Examples:
 * - "possibility yes" → finds leads with both terms
 * - "possibility OR yes" → finds leads with either term
 * - "possibility NOT workshop" → finds leads with possibility but not workshop
 * - "(possibility OR yes) AND mindset" → finds leads with mindset AND (possibility OR yes)
 */

/**
 * Token types for lexical analysis
 */
const TokenType = {
  TERM: 'TERM',
  AND: 'AND',
  OR: 'OR',
  NOT: 'NOT',
  LPAREN: 'LPAREN',
  RPAREN: 'RPAREN',
  EOF: 'EOF'
};

/**
 * Tokenize the input string into an array of tokens
 */
function tokenize(input) {
  const tokens = [];
  let i = 0;
  
  while (i < input.length) {
    // Skip whitespace
    if (/\s/.test(input[i])) {
      i++;
      continue;
    }
    
    // Check for quoted strings
    if (input[i] === '"' || input[i] === "'") {
      const quote = input[i];
      i++; // Skip opening quote
      let term = '';
      while (i < input.length && input[i] !== quote) {
        term += input[i];
        i++;
      }
      i++; // Skip closing quote
      tokens.push({ type: TokenType.TERM, value: term });
      continue;
    }
    
    // Check for parentheses
    if (input[i] === '(') {
      tokens.push({ type: TokenType.LPAREN });
      i++;
      continue;
    }
    
    if (input[i] === ')') {
      tokens.push({ type: TokenType.RPAREN });
      i++;
      continue;
    }
    
    // Check for minus (NOT prefix)
    if (input[i] === '-') {
      i++;
      // Get the term after the minus
      let term = '';
      while (i < input.length && !/[\s()]/.test(input[i])) {
        term += input[i];
        i++;
      }
      tokens.push({ type: TokenType.NOT });
      tokens.push({ type: TokenType.TERM, value: term });
      continue;
    }
    
    // Read a word
    let word = '';
    while (i < input.length && !/[\s()]/.test(input[i])) {
      word += input[i];
      i++;
    }
    
    // Check if word is an operator
    const upperWord = word.toUpperCase();
    if (upperWord === 'AND') {
      tokens.push({ type: TokenType.AND });
    } else if (upperWord === 'OR') {
      tokens.push({ type: TokenType.OR });
    } else if (upperWord === 'NOT') {
      tokens.push({ type: TokenType.NOT });
    } else {
      tokens.push({ type: TokenType.TERM, value: word });
    }
  }
  
  tokens.push({ type: TokenType.EOF });
  return tokens;
}

/**
 * Parse tokens into an abstract syntax tree (AST)
 */
class Parser {
  constructor(tokens) {
    this.tokens = tokens;
    this.current = 0;
  }
  
  peek() {
    return this.tokens[this.current];
  }
  
  consume() {
    return this.tokens[this.current++];
  }
  
  match(...types) {
    const token = this.peek();
    return types.includes(token.type);
  }
  
  /**
   * Main parsing entry point
   * Grammar: expression = orExpression
   */
  parse() {
    const result = this.parseOrExpression();
    if (this.peek().type !== TokenType.EOF) {
      throw new Error('Unexpected tokens after expression');
    }
    return result;
  }
  
  /**
   * OR has lowest precedence
   * orExpression = andExpression (OR andExpression)*
   */
  parseOrExpression() {
    let left = this.parseAndExpression();
    
    while (this.match(TokenType.OR)) {
      this.consume(); // consume OR
      const right = this.parseAndExpression();
      left = { type: 'OR', left, right };
    }
    
    return left;
  }
  
  /**
   * AND has higher precedence than OR
   * andExpression = notExpression (AND? notExpression)*
   * Note: AND is implicit between terms without operators
   */
  parseAndExpression() {
    let left = this.parseNotExpression();
    
    while (this.match(TokenType.TERM, TokenType.NOT, TokenType.LPAREN) || 
           this.match(TokenType.AND)) {
      // Consume explicit AND if present
      if (this.match(TokenType.AND)) {
        this.consume();
      }
      
      const right = this.parseNotExpression();
      left = { type: 'AND', left, right };
    }
    
    return left;
  }
  
  /**
   * NOT has highest precedence
   * notExpression = NOT? primaryExpression
   */
  parseNotExpression() {
    if (this.match(TokenType.NOT)) {
      this.consume(); // consume NOT
      const expr = this.parsePrimaryExpression();
      return { type: 'NOT', expr };
    }
    
    return this.parsePrimaryExpression();
  }
  
  /**
   * Primary expressions are terms or parenthesized expressions
   * primaryExpression = TERM | '(' orExpression ')'
   */
  parsePrimaryExpression() {
    if (this.match(TokenType.TERM)) {
      const token = this.consume();
      return { type: 'TERM', value: token.value };
    }
    
    if (this.match(TokenType.LPAREN)) {
      this.consume(); // consume (
      const expr = this.parseOrExpression();
      if (!this.match(TokenType.RPAREN)) {
        throw new Error('Expected closing parenthesis');
      }
      this.consume(); // consume )
      return expr;
    }
    
    throw new Error('Expected term or opening parenthesis');
  }
}

/**
 * Convert AST to Airtable formula
 * @param {Object} ast - Abstract syntax tree node
 * @param {Array<string>} searchFields - Airtable field names to search in
 * @returns {string} Airtable filter formula
 */
function astToAirtableFormula(ast, searchFields = ['{Search Tokens (canonical)}', '{Search Terms}']) {
  if (!ast) return '';
  
  switch (ast.type) {
    case 'TERM': {
      const term = ast.value.toLowerCase();
      // Search in all specified fields
      const fieldSearches = searchFields.map(field => 
        `SEARCH("${term}", LOWER(${field})) > 0`
      );
      return fieldSearches.length > 1 
        ? `OR(${fieldSearches.join(', ')})` 
        : fieldSearches[0];
    }
    
    case 'AND': {
      const leftFormula = astToAirtableFormula(ast.left, searchFields);
      const rightFormula = astToAirtableFormula(ast.right, searchFields);
      return `AND(${leftFormula}, ${rightFormula})`;
    }
    
    case 'OR': {
      const leftFormula = astToAirtableFormula(ast.left, searchFields);
      const rightFormula = astToAirtableFormula(ast.right, searchFields);
      return `OR(${leftFormula}, ${rightFormula})`;
    }
    
    case 'NOT': {
      const exprFormula = astToAirtableFormula(ast.expr, searchFields);
      return `NOT(${exprFormula})`;
    }
    
    default:
      throw new Error(`Unknown AST node type: ${ast.type}`);
  }
}

/**
 * Main function: Parse boolean search query and convert to Airtable formula
 * @param {string} query - Boolean search query
 * @param {Array<string>} searchFields - Airtable field names to search in
 * @returns {string} Airtable filter formula
 */
function parseBooleanSearch(query, searchFields = ['{Search Tokens (canonical)}', '{Search Terms}']) {
  if (!query || query.trim() === '') {
    return '';
  }
  
  try {
    const tokens = tokenize(query);
    const parser = new Parser(tokens);
    const ast = parser.parse();
    return astToAirtableFormula(ast, searchFields);
  } catch (error) {
    // If parsing fails, fall back to simple search (treat as single term)
    console.warn('Boolean search parsing failed, falling back to simple search:', error.message);
    const term = query.toLowerCase();
    const fieldSearches = searchFields.map(field => 
      `SEARCH("${term}", LOWER(${field})) > 0`
    );
    return fieldSearches.length > 1 
      ? `OR(${fieldSearches.join(', ')})` 
      : fieldSearches[0];
  }
}

/**
 * Extract simple terms from a boolean query (for backwards compatibility)
 * Returns an array of all terms without operators
 */
function extractTerms(query) {
  if (!query || query.trim() === '') {
    return [];
  }
  
  const tokens = tokenize(query);
  return tokens
    .filter(token => token.type === TokenType.TERM)
    .map(token => token.value.toLowerCase())
    .filter(Boolean);
}

module.exports = {
  parseBooleanSearch,
  extractTerms,
  TokenType,
  tokenize,
  Parser
};
