#!/usr/bin/env python3
"""
Sanity-check script for Hypothesis AI Search experiment logs.

Usage:
    python scripts/inspect-experiment-log.py experiment-log-2026-03-27.json
    python scripts/inspect-experiment-log.py log1.json log2.json   # merge multiple logs
"""

import json
import sys
from collections import Counter
from datetime import datetime


def load_and_merge(paths: list[str]) -> dict:
    """Load one or more log files and merge them by user."""
    merged: dict = {"version": 1, "users": {}}
    for path in paths:
        with open(path) as f:
            log = json.load(f)
        for user, user_log in log.get("users", {}).items():
            if user not in merged["users"]:
                merged["users"][user] = {
                    "events": [],
                    "annotationStatuses": {},
                }
            merged["users"][user]["events"].extend(user_log.get("events", []))
            merged["users"][user]["annotationStatuses"].update(
                user_log.get("annotationStatuses", {})
            )
    # Sort each user's events by timestamp.
    for user_log in merged["users"].values():
        user_log["events"].sort(key=lambda e: e.get("timestamp", ""))
    return merged


def print_section(title: str):
    print(f"\n{'=' * 60}")
    print(f"  {title}")
    print(f"{'=' * 60}")


def print_subsection(title: str):
    print(f"\n  --- {title} ---")


def inspect(log: dict):
    users = log.get("users", {})
    if not users:
        print("Log is empty (no users).")
        return

    exported_at = log.get("exportedAt")
    if exported_at:
        print(f"Exported at: {exported_at}")

    # ---------------------------------------------------------------
    # Per-user summary
    # ---------------------------------------------------------------
    for user, user_log in sorted(users.items()):
        print_section(f"User: {user}")

        events = user_log.get("events", [])
        statuses = user_log.get("annotationStatuses", {})

        # Event counts by type.
        event_counts = Counter(e["type"] for e in events)
        print_subsection("Event counts")
        for event_type in ["search", "rerun-search", "accept", "reject", "delete-pending", "delete-all"]:
            print(f"    {event_type:20s} {event_counts.get(event_type, 0)}")
        print(f"    {'TOTAL':20s} {len(events)}")

        # Annotation status tallies.
        status_counts = Counter(s["status"] for s in statuses.values())
        print_subsection("Annotation statuses")
        for status in ["suggested", "accepted", "rejected"]:
            print(f"    {status:20s} {status_counts.get(status, 0)}")
        print(f"    {'TOTAL':20s} {len(statuses)}")

        # Per-document breakdown.
        doc_events: dict[str, list] = {}
        for e in events:
            uri = e.get("documentUri", "(unknown)")
            doc_events.setdefault(uri, []).append(e)

        doc_statuses: dict[str, list] = {}
        for s in statuses.values():
            uri = s.get("documentUri", "(unknown)")
            doc_statuses.setdefault(uri, []).append(s)

        all_uris = sorted(set(doc_events) | set(doc_statuses))
        if len(all_uris) > 1:
            print_subsection("Per-document breakdown")
            for uri in all_uris:
                de = doc_events.get(uri, [])
                ds = doc_statuses.get(uri, [])
                ec = Counter(e["type"] for e in de)
                sc = Counter(s["status"] for s in ds)
                short_uri = uri if len(uri) <= 60 else "..." + uri[-57:]
                print(f"\n    Document: {short_uri}")
                print(f"      Events:  {dict(ec)}")
                print(f"      Statuses: {dict(sc)}")

        # Timeline.
        print_subsection("Event timeline")
        for e in events:
            ts = e.get("timestamp", "?")
            try:
                ts_short = datetime.fromisoformat(ts).strftime("%Y-%m-%d %H:%M:%S")
            except (ValueError, TypeError):
                ts_short = ts
            etype = e["type"]
            if etype == "search":
                detail = (
                    f'tag="{e.get("schemaTag", "")}" '
                    f'query="{e.get("query", "")[:50]}" '
                    f'annotations={len(e.get("annotationIdsCreated", []))}'
                )
            elif etype == "rerun-search":
                detail = (
                    f'tag="{e.get("schemaTag", "")}" '
                    f'query="{e.get("query", "")[:50]}" '
                    f'deleted={len(e.get("deletedAnnotationIds", []))}'
                )
            elif etype in ("accept", "reject"):
                quote = e.get("quoteText", "")
                quote_short = (quote[:40] + "...") if len(quote) > 40 else quote
                detail = f'ann={e.get("annotationId", "?")} quote="{quote_short}"'
            elif etype == "delete-pending":
                detail = (
                    f'tag="{e.get("schemaTag", "")}" '
                    f'query="{e.get("query", "")[:50]}" '
                    f'deleted={len(e.get("deletedAnnotationIds", []))}'
                )
            elif etype == "delete-all":
                detail = (
                    f'tag="{e.get("schemaTag", "")}" '
                    f'query="{e.get("query", "")[:50]}" '
                    f'deleted={len(e.get("deletedAnnotationIds", []))} '
                    f'untagged={len(e.get("untaggedAnnotationIds", []))}'
                )
            else:
                detail = ""
            print(f"    [{ts_short}] {etype:15s} {detail}")

        # ---------------------------------------------------------------
        # Warnings / anomalies
        # ---------------------------------------------------------------
        warnings = []

        # Annotations accepted/rejected without a search event that
        # created them.
        search_created_ids: set[str] = set()
        for e in events:
            if e["type"] == "search":
                search_created_ids.update(e.get("annotationIdsCreated", []))
        for e in events:
            if e["type"] in ("accept", "reject"):
                ann_id = e.get("annotationId", "")
                if ann_id and ann_id not in search_created_ids:
                    warnings.append(
                        f'{e["type"]} for annotation {ann_id} '
                        f"has no matching search event"
                    )

        # Annotations still in 'suggested' state.
        suggested = [
            s for s in statuses.values() if s["status"] == "suggested"
        ]
        if suggested:
            warnings.append(
                f"{len(suggested)} annotation(s) still in 'suggested' state "
                f"(never accepted or rejected)"
            )

        # Duplicate events (same type + annotationId + timestamp).
        seen_events: set[tuple] = set()
        for e in events:
            key = (e["type"], e.get("annotationId", ""), e.get("timestamp", ""))
            if key in seen_events:
                warnings.append(f"Possible duplicate event: {key}")
            seen_events.add(key)

        if warnings:
            print_subsection("Warnings")
            for w in warnings:
                print(f"    [!] {w}")
        else:
            print_subsection("Warnings")
            print("    None")


def main():
    if len(sys.argv) < 2:
        print(f"Usage: {sys.argv[0]} <log.json> [log2.json ...]")
        sys.exit(1)

    log = load_and_merge(sys.argv[1:])
    inspect(log)


if __name__ == "__main__":
    main()
