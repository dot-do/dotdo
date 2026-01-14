const query = 'CREATE (n:Person {name: "Alice"}) RETURN n';
const normalized = query.trim().replace(/\s+/g, ' ');

// Original regex
const returnMatch1 = normalized.match(/RETURN\s+(.+?)(?=\s+(?:ORDER|SKIP|LIMIT|$))/is);
console.log("Return match 1:", returnMatch1);

// Try different regex
const returnMatch2 = normalized.match(/RETURN\s+(.+?)(?:\s+ORDER|\s+SKIP|\s+LIMIT|$)/is);
console.log("Return match 2:", returnMatch2);

// Try simpler
const returnMatch3 = normalized.match(/RETURN\s+(.+)$/is);
console.log("Return match 3:", returnMatch3);
