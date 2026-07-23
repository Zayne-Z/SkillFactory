const ALLOWED_FIRST_KEYWORDS = new Set(['SELECT', 'SHOW', 'DESCRIBE', 'DESC', 'EXPLAIN', 'WITH']);
const BLOCKED_KEYWORDS = new Set([
  'INSERT',
  'UPDATE',
  'DELETE',
  'REPLACE',
  'CREATE',
  'ALTER',
  'DROP',
  'TRUNCATE',
  'RENAME',
  'GRANT',
  'REVOKE',
  'CALL',
  'DO',
  'HANDLER',
  'LOAD',
  'LOCK',
  'UNLOCK',
  'SET',
  'USE',
  'ANALYZE',
  'OPTIMIZE',
  'REPAIR',
  'FLUSH',
  'RESET',
  'KILL',
  'SHUTDOWN',
  'START',
  'TRANSACTION',
  'COMMIT',
  'ROLLBACK',
  'SAVEPOINT',
  'RELEASE',
  'OUTFILE',
  'DUMPFILE',
  'LOAD_FILE',
  'BENCHMARK',
  'SLEEP',
  'PROCESSLIST',
  'GET_LOCK',
  'RELEASE_LOCK',
  'IS_FREE_LOCK',
  'IS_USED_LOCK',
  'SHARE',
]);

function stripLiteralsAndComments(sql) {
  let result = '';
  let index = 0;
  while (index < sql.length) {
    const current = sql[index];
    const next = sql[index + 1];
    if (current === '-' && next === '-') {
      result += '  ';
      index += 2;
      while (index < sql.length && sql[index] !== '\n') {
        result += ' ';
        index += 1;
      }
      continue;
    }
    if (current === '#') {
      result += ' ';
      index += 1;
      while (index < sql.length && sql[index] !== '\n') {
        result += ' ';
        index += 1;
      }
      continue;
    }
    if (current === '/' && next === '*') {
      result += '  ';
      index += 2;
      while (index < sql.length && !(sql[index] === '*' && sql[index + 1] === '/')) {
        result += sql[index] === '\n' ? '\n' : ' ';
        index += 1;
      }
      if (index < sql.length) {
        result += '  ';
        index += 2;
      }
      continue;
    }
    if (current === '\'' || current === '"' || current === '`') {
      const quote = current;
      result += ' ';
      index += 1;
      while (index < sql.length) {
        const char = sql[index];
        if (char === '\\') {
          result += '  ';
          index += 2;
          continue;
        }
        if (char === quote) {
          if (sql[index + 1] === quote) {
            result += '  ';
            index += 2;
            continue;
          }
          result += ' ';
          index += 1;
          break;
        }
        result += char === '\n' ? '\n' : ' ';
        index += 1;
      }
      continue;
    }
    result += current;
    index += 1;
  }
  return result;
}

function validateReadOnlySql(sql) {
  if (typeof sql !== 'string' || !sql.trim()) return { ok: false, reason: 'SQL 不能为空。' };
  if (/\/\*!/.test(sql)) return { ok: false, reason: '不允许使用 MySQL 可执行注释。' };
  const stripped = stripLiteralsAndComments(sql).trim();
  const withoutTrailingSemicolon = stripped.endsWith(';') ? stripped.slice(0, -1).trimEnd() : stripped;
  if (withoutTrailingSemicolon.includes(';')) {
    return { ok: false, reason: '一次只允许执行一条 SQL。' };
  }
  const tokens = withoutTrailingSemicolon.match(/[A-Za-z_][A-Za-z0-9_$]*/g)?.map((token) => token.toUpperCase()) || [];
  if (tokens.length === 0) return { ok: false, reason: '没有识别到 SQL 语句。' };
  if (!ALLOWED_FIRST_KEYWORDS.has(tokens[0])) {
    return { ok: false, reason: `只允许 SELECT、SHOW、DESCRIBE、DESC、EXPLAIN 和只读 WITH 语句，当前为 ${tokens[0]}。` };
  }
  const blocked = tokens.find((token, index) => {
    if (tokens[0] === 'SHOW' && index === 1 && token === 'CREATE') return false;
    return BLOCKED_KEYWORDS.has(token);
  });
  if (blocked) return { ok: false, reason: `只读策略拒绝关键字 ${blocked}。` };
  return { ok: true, firstKeyword: tokens[0] };
}

function assertReadOnlySql(sql) {
  const result = validateReadOnlySql(sql);
  if (!result.ok) throw new Error(result.reason);
  return result;
}

module.exports = {
  ALLOWED_FIRST_KEYWORDS,
  BLOCKED_KEYWORDS,
  assertReadOnlySql,
  stripLiteralsAndComments,
  validateReadOnlySql,
};
