#!/usr/bin/env python3
"""
ClickBench Worker Benchmark Suite

Tests the chdb-lake Cloudflare Worker with ClickBench queries against
hits_sample.parquet stored in R2.

Usage:
    python benchmarks/worker-bench.py [--url URL] [--verbose]

Options:
    --url URL       Worker URL (default: https://chdb-lake.dotdo.workers.dev)
    --verbose       Enable verbose output
    --local         Use local development server (http://localhost:8789)
"""

import argparse
import json
import sys
import time
import urllib.parse
import urllib.request
from dataclasses import dataclass
from typing import Any, Dict, List, Optional


# Default Worker URL
DEFAULT_WORKER_URL = "https://chdb-lake.dotdo.workers.dev"
LOCAL_WORKER_URL = "http://localhost:8789"

# R2 bucket path to hits_sample.parquet
HITS_PARQUET_PATH = "r2://data/clickbench/hits_sample.parquet"


@dataclass
class QueryResult:
    """Result from executing a query."""
    name: str
    category: str
    query: str
    success: bool
    error: Optional[str] = None
    rows: int = 0
    elapsed_ms: float = 0
    response_size: int = 0


# Test queries organized by category
TEST_QUERIES = {
    "basic": [
        ("SELECT 1", "Simple SELECT"),
        ("SELECT 1 + 1", "Arithmetic"),
        ("SELECT version()", "System function"),
        ("SELECT now()", "Time function"),
    ],
    "numbers": [
        ("SELECT number FROM numbers(10)", "Generate 10 numbers"),
        ("SELECT count(*) FROM numbers(1000)", "Count 1000 numbers"),
        ("SELECT sum(number) FROM numbers(100)", "Sum 100 numbers"),
        ("SELECT avg(number) FROM numbers(100)", "Average 100 numbers"),
    ],
    "filter": [
        ("SELECT number FROM numbers(100) WHERE number > 50", "Filter numbers > 50"),
        ("SELECT number FROM numbers(100) WHERE number % 2 = 0 LIMIT 10", "Even numbers limit 10"),
    ],
    "string": [
        ("SELECT length('hello world')", "String length"),
        ("SELECT upper('hello')", "String upper"),
        ("SELECT lower('HELLO')", "String lower"),
        ("SELECT concat('Hello', ' ', 'World')", "String concat"),
    ],
    "system": [
        ("SHOW DATABASES", "Show databases"),
        ("SHOW TABLES", "Show tables"),
    ],
    "arithmetic": [
        ("SELECT 1 + 2 + 3 + 4 + 5", "Addition chain"),
        ("SELECT 10 * 20 / 5", "Multiplication and division"),
        ("SELECT abs(-42)", "Absolute value"),
        ("SELECT sqrt(16)", "Square root"),
        ("SELECT floor(3.7)", "Floor function"),
        ("SELECT ceil(3.2)", "Ceiling function"),
    ],
    "clickbench": [
        # These queries target the hits_sample.parquet file via s3()
        (f"SELECT count(*) FROM s3('{HITS_PARQUET_PATH}')", "Q0: Count all rows"),
        (f"SELECT count(*) FROM s3('{HITS_PARQUET_PATH}') WHERE AdvEngineID <> 0", "Q1: Count with filter"),
        (f"SELECT sum(AdvEngineID), count(*), avg(ResolutionWidth) FROM s3('{HITS_PARQUET_PATH}')", "Q2: Multiple aggregations"),
        (f"SELECT avg(UserID) FROM s3('{HITS_PARQUET_PATH}')", "Q3: Average UserID"),
        (f"SELECT min(EventDate), max(EventDate) FROM s3('{HITS_PARQUET_PATH}')", "Q6: Min/Max dates"),
        (f"SELECT count(DISTINCT UserID) FROM s3('{HITS_PARQUET_PATH}')", "Q4: Count distinct UserID"),
        (f"SELECT count(DISTINCT SearchPhrase) FROM s3('{HITS_PARQUET_PATH}')", "Q5: Count distinct SearchPhrase"),
        (f"SELECT AdvEngineID, count(*) as c FROM s3('{HITS_PARQUET_PATH}') WHERE AdvEngineID <> 0 GROUP BY AdvEngineID ORDER BY c DESC LIMIT 10", "Q7: Group by AdvEngineID"),
    ],
}


def execute_query(url: str, query: str, timeout: int = 30) -> Dict[str, Any]:
    """Execute a query against the Worker and return the response."""
    encoded_query = urllib.parse.quote(query)
    full_url = f"{url}/?query={encoded_query}&default_format=JSON"

    start_time = time.time()
    try:
        req = urllib.request.Request(full_url)
        req.add_header('Accept', 'application/json')

        with urllib.request.urlopen(req, timeout=timeout) as response:
            data = response.read()
            elapsed_ms = (time.time() - start_time) * 1000

            try:
                result = json.loads(data)
                return {
                    "success": True,
                    "data": result,
                    "elapsed_ms": elapsed_ms,
                    "response_size": len(data),
                }
            except json.JSONDecodeError:
                return {
                    "success": True,
                    "data": {"raw": data.decode('utf-8')},
                    "elapsed_ms": elapsed_ms,
                    "response_size": len(data),
                }
    except urllib.error.HTTPError as e:
        elapsed_ms = (time.time() - start_time) * 1000
        error_body = e.read().decode('utf-8', errors='replace')
        return {
            "success": False,
            "error": f"HTTP {e.code}: {error_body[:200]}",
            "elapsed_ms": elapsed_ms,
            "response_size": 0,
        }
    except urllib.error.URLError as e:
        elapsed_ms = (time.time() - start_time) * 1000
        return {
            "success": False,
            "error": f"URL Error: {str(e.reason)}",
            "elapsed_ms": elapsed_ms,
            "response_size": 0,
        }
    except Exception as e:
        elapsed_ms = (time.time() - start_time) * 1000
        return {
            "success": False,
            "error": str(e),
            "elapsed_ms": elapsed_ms,
            "response_size": 0,
        }


def run_benchmarks(url: str, verbose: bool = False) -> List[QueryResult]:
    """Run all benchmark queries and return results."""
    results = []

    # First, test connectivity
    print(f"Testing connectivity to {url}...")
    ping_result = execute_query(url, "SELECT 1", timeout=10)
    if not ping_result["success"]:
        print(f"ERROR: Cannot connect to Worker: {ping_result.get('error', 'Unknown error')}")
        return results
    print(f"  Connected! Latency: {ping_result['elapsed_ms']:.2f}ms\n")

    # Run all query categories
    for category, queries in TEST_QUERIES.items():
        print(f"\n=== {category.upper()} ===")

        for query, name in queries:
            if verbose:
                print(f"  Running: {name}")
                print(f"    Query: {query[:80]}{'...' if len(query) > 80 else ''}")

            result = execute_query(url, query, timeout=60)

            rows = 0
            if result["success"] and "data" in result["data"]:
                rows = len(result["data"].get("data", []))

            query_result = QueryResult(
                name=name,
                category=category,
                query=query,
                success=result["success"],
                error=result.get("error"),
                rows=rows,
                elapsed_ms=result["elapsed_ms"],
                response_size=result["response_size"],
            )
            results.append(query_result)

            if result["success"]:
                print(f"  PASS: {name} ({result['elapsed_ms']:.2f}ms, {rows} rows)")
                if verbose and rows > 0:
                    print(f"    Sample: {json.dumps(result['data'].get('data', [])[:2])[:100]}")
            else:
                print(f"  FAIL: {name}")
                print(f"    Error: {result.get('error', 'Unknown error')[:100]}")

    return results


def print_summary(results: List[QueryResult]):
    """Print a summary of benchmark results."""
    print("\n" + "=" * 60)
    print("BENCHMARK SUMMARY")
    print("=" * 60)

    # Group by category
    categories = {}
    for r in results:
        if r.category not in categories:
            categories[r.category] = {"passed": 0, "failed": 0, "total_ms": 0}
        if r.success:
            categories[r.category]["passed"] += 1
            categories[r.category]["total_ms"] += r.elapsed_ms
        else:
            categories[r.category]["failed"] += 1

    total_passed = sum(c["passed"] for c in categories.values())
    total_failed = sum(c["failed"] for c in categories.values())
    total = total_passed + total_failed

    print(f"\nTotal: {total_passed}/{total} queries passing\n")

    print("By Category:")
    print("-" * 50)
    print(f"{'Category':<20} {'Passed':<10} {'Failed':<10} {'Avg Time':<12}")
    print("-" * 50)

    for cat, stats in sorted(categories.items()):
        passed = stats["passed"]
        failed = stats["failed"]
        avg_ms = stats["total_ms"] / max(passed, 1)
        print(f"{cat:<20} {passed:<10} {failed:<10} {avg_ms:.2f}ms")

    print("-" * 50)

    # Print failed queries
    failed_results = [r for r in results if not r.success]
    if failed_results:
        print("\nFailed Queries:")
        print("-" * 50)
        for r in failed_results:
            print(f"  [{r.category}] {r.name}")
            print(f"    Query: {r.query[:60]}{'...' if len(r.query) > 60 else ''}")
            print(f"    Error: {r.error[:80] if r.error else 'Unknown'}")
        print()

    # Return success status
    return total_failed == 0


def main():
    parser = argparse.ArgumentParser(description="ClickBench Worker Benchmark Suite")
    parser.add_argument("--url", default=DEFAULT_WORKER_URL, help="Worker URL")
    parser.add_argument("--verbose", "-v", action="store_true", help="Verbose output")
    parser.add_argument("--local", action="store_true", help="Use local development server")
    args = parser.parse_args()

    url = LOCAL_WORKER_URL if args.local else args.url

    print("=" * 60)
    print("CLICKBENCH WORKER BENCHMARK")
    print("=" * 60)
    print(f"Target: {url}")
    print(f"Time: {time.strftime('%Y-%m-%d %H:%M:%S')}")
    print()

    results = run_benchmarks(url, verbose=args.verbose)

    if results:
        success = print_summary(results)
        sys.exit(0 if success else 1)
    else:
        print("ERROR: No results collected")
        sys.exit(1)


if __name__ == "__main__":
    main()
