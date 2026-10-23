import sys
import unittest
import urllib.parse
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import calls  # noqa: E402
import gifs  # noqa: E402
from test_calls import HubTestCase  # noqa: E402


API_KEY = "test-klipy-key-123"


def variant(name, width=200, height=150, size=1000, host="static.klipy.com"):
    return {"url": f"https://{host}/ii/abc/{name}", "width": width, "height": height, "size": size}


def item(gif_id=1, **overrides):
    entry = {
        "id": gif_id,
        "slug": f"gif-{gif_id}",
        "title": f"GIF {gif_id}",
        "type": "gif",
        "file": {
            "hd": {"gif": variant(f"{gif_id}-hd.gif", 498, 498, 3_000_000)},
            "md": {"gif": variant(f"{gif_id}-md.gif", 320, 320, 900_000), "webp": variant(f"{gif_id}-md.webp")},
            "sm": {"gif": variant(f"{gif_id}-sm.gif", 220, 220), "webp": variant(f"{gif_id}-sm.webp", 220, 220, 80_000)},
            "xs": {"gif": variant(f"{gif_id}-xs.gif", 90, 90)},
        },
    }
    entry.update(overrides)
    return entry


def response(items, has_next=False):
    return {"result": True, "data": {"data": items, "current_page": 1, "per_page": 24, "has_next": has_next}}


class FakeProvider:
    def __init__(self, payload=None, error=None):
        self.payload = payload if payload is not None else response([item(1), item(2)], has_next=True)
        self.error = error
        self.urls = []

    def __call__(self, url):
        self.urls.append(url)
        if self.error is not None:
            raise self.error
        return self.payload


class NormalizeTests(unittest.TestCase):
    def test_picks_medium_gif_and_animated_preview(self):
        results, has_next = gifs.normalize_response(response([item(42)], has_next=True))
        self.assertTrue(has_next)
        self.assertEqual(results, [{
            "id": "42", "title": "GIF 42",
            "url": "https://static.klipy.com/ii/abc/42-md.gif", "width": 320, "height": 320, "size": 900_000,
            "previewUrl": "https://static.klipy.com/ii/abc/42-sm.webp", "previewWidth": 220, "previewHeight": 220,
        }])

    def test_rejects_foreign_hosts_http_and_ads(self):
        foreign = item(1)
        foreign["file"] = {"md": {"gif": variant("x.gif", host="evil.example.com")}}
        insecure = item(2)
        insecure["file"] = {"md": {"gif": {"url": "http://static.klipy.com/x.gif"}}}
        lookalike = item(3)
        lookalike["file"] = {"md": {"gif": variant("x.gif", host="static.klipy.com.evil.test")}}
        with_login = item(4)
        with_login["file"] = {"md": {"gif": {"url": "https://user@static.klipy.com/x.gif"}}}
        advert = item(5, type="ad")
        results, _ = gifs.normalize_response(response([foreign, insecure, lookalike, with_login, advert, item(6)]))
        self.assertEqual([r["id"] for r in results], ["6"])

    def test_skips_bad_ids_duplicates_and_oversized_gifs(self):
        too_big = item(3)
        too_big["file"] = {"md": {"gif": variant("big.gif", size=gifs.MAX_GIF_BYTES + 1)}}
        results, _ = gifs.normalize_response(response([
            item("../etc"), item(True), item(None), item(1), item(1), too_big, "junk", None,
        ]))
        self.assertEqual([r["id"] for r in results], ["1"])

    def test_falls_back_to_larger_size_and_sends_gif_as_preview(self):
        only_hd = item(7)
        only_hd["file"] = {"hd": {"gif": variant("7-hd.gif", 498, 498, 2_000_000)}}
        [result], _ = gifs.normalize_response(response([only_hd]))
        self.assertEqual(result["url"], "https://static.klipy.com/ii/abc/7-hd.gif")
        self.assertEqual(result["previewUrl"], result["url"])

    def test_cleans_title_and_dimensions(self):
        odd = item(8, title="  Hi\u0000\nthere  " + "x" * 300)
        odd["file"]["md"]["gif"]["width"] = -5
        odd["file"]["md"]["gif"]["height"] = "320"
        [result], _ = gifs.normalize_response(response([odd]))
        self.assertTrue(result["title"].startswith("Hi there "))
        self.assertLessEqual(len(result["title"]), gifs.MAX_TITLE_CHARS)
        self.assertIsNone(result["width"])
        self.assertIsNone(result["height"])

    def test_unexpected_payload_is_provider_failure(self):
        for payload in (None, [], {"result": False}, {"result": True, "data": {"data": "x"}}):
            with self.assertRaises(calls.CallError) as raised:
                gifs.normalize_response(payload)
            self.assertEqual(raised.exception.code, "gifs_failed")

    def test_locale_to_country(self):
        self.assertEqual(gifs.country_for_locale("ru"), "ru")
        self.assertEqual(gifs.country_for_locale("en-GB"), "gb")
        self.assertEqual(gifs.country_for_locale("pt_BR"), "br")
        self.assertEqual(gifs.country_for_locale("ja"), "jp")
        self.assertEqual(gifs.country_for_locale("uk"), "ua")
        self.assertEqual(gifs.country_for_locale("zh-Hant"), "tw")
        self.assertIsNone(gifs.country_for_locale("tlh"))
        self.assertIsNone(gifs.country_for_locale("ru&x=1"))
        self.assertIsNone(gifs.country_for_locale(42))

    def test_query_validation(self):
        self.assertEqual(gifs.normalize_query("  кошки\n​ и\tсобаки "), "кошки и собаки")
        self.assertEqual(gifs.normalize_query(None), "")
        for bad in (42, ["x"], "x" * (gifs.MAX_QUERY_CHARS + 1)):
            with self.assertRaises(calls.CallError) as raised:
                gifs.normalize_query(bad)
            self.assertEqual(raised.exception.code, "invalid_query")


class GifHubTestCase(HubTestCase):
    def setUp(self):
        super().setUp()
        self.provider = FakeProvider()
        self.logs = []
        self.service = gifs.GifService(API_KEY, fetch=self.provider, clock=self.clock, log=self.logs.append)
        self.hub.gifs = self.service
        self.peer = self.connect()

    def search(self, peer=None, **fields):
        peer = peer or self.peer
        self.hub.handle(peer, {"type": "gif-search", "requestId": "gif-1", **fields})
        return self.last(peer)


class GifSearchTests(GifHubTestCase):
    def test_search_returns_results_with_request_id(self):
        reply = self.search(query="кошки", locale="ru-RU")
        self.assertEqual(reply["type"], "gif-results")
        self.assertEqual(reply["requestId"], "gif-1")
        self.assertEqual(reply["provider"], "klipy")
        self.assertTrue(reply["hasNext"])
        self.assertEqual([r["id"] for r in reply["results"]], ["1", "2"])
        url = urllib.parse.urlsplit(self.provider.urls[0])
        self.assertEqual(url.netloc, "api.klipy.com")
        self.assertEqual(url.path, f"/api/v1/{API_KEY}/gifs/search")
        params = urllib.parse.parse_qs(url.query)
        self.assertEqual(params["q"], ["кошки"])
        self.assertEqual(params["locale"], ["ru"])
        self.assertEqual(params["content_filter"], ["medium"])

    def test_empty_query_is_trending(self):
        reply = self.search(locale="de")
        self.assertEqual(reply["type"], "gif-results")
        url = urllib.parse.urlsplit(self.provider.urls[0])
        self.assertTrue(url.path.endswith("/gifs/trending"))
        self.assertNotIn("q", urllib.parse.parse_qs(url.query))

    def test_requires_license(self):
        peer = calls.Peer(lambda message: None)
        inbox = []
        peer.send = inbox.append
        self.hub.handle(peer, {"type": "gif-search", "requestId": "gif-1", "query": "x"})
        self.assertEqual(inbox[-1]["code"], "not_authenticated")
        self.assertEqual(self.provider.urls, [])

    def test_without_key_reports_unavailable(self):
        self.hub.gifs = gifs.GifService("", fetch=self.provider, clock=self.clock)
        reply = self.search(query="cats")
        self.assertEqual(reply["type"], "error")
        self.assertEqual(reply["code"], "gifs_unavailable")
        self.assertEqual(reply["requestId"], "gif-1")
        self.assertEqual(self.provider.urls, [])

    def test_old_server_without_service_reports_unknown_type(self):
        self.hub.gifs = None
        self.assertEqual(self.search(query="cats")["code"], "unknown_type")

    def test_bad_input(self):
        self.assertEqual(self.search(query="x" * 101)["code"], "invalid_query")
        self.assertEqual(self.search(query=5)["code"], "invalid_query")
        self.assertEqual(self.search(query="ok", page=0)["code"], "invalid_query")
        self.assertEqual(self.search(query="ok", page="2")["code"], "invalid_query")
        self.assertEqual(self.provider.urls, [])
        # Странная локаль не ломает поиск: просто без `locale`.
        reply = self.search(query="ok", locale="../../x")
        self.assertEqual(reply["type"], "gif-results")
        self.assertNotIn("locale", urllib.parse.parse_qs(urllib.parse.urlsplit(self.provider.urls[0]).query))

    def test_provider_failure_is_reported_without_secrets(self):
        self.provider.error = gifs.ProviderError("HTTP 403")
        reply = self.search(query="cats")
        self.assertEqual(reply["code"], "gifs_failed")
        self.assertEqual(reply["requestId"], "gif-1")
        self.assertEqual(self.logs, ["GIF provider request failed: HTTP 403"])
        self.assertNotIn(API_KEY, " ".join(self.logs))
        self.assertNotIn("cats", " ".join(self.logs))

    def test_cache_hits_and_expiry(self):
        self.search(query="Cats", locale="en")
        self.search(query="cats", locale="en-US")
        self.assertEqual(len(self.provider.urls), 1)
        self.search(query="cats", locale="ru")
        self.assertEqual(len(self.provider.urls), 2)
        self.clock.value += gifs.CACHE_TTL_SECONDS + 1
        self.search(query="cats", locale="en")
        self.assertEqual(len(self.provider.urls), 3)

    def test_cache_is_bounded(self):
        for index in range(gifs.CACHE_MAX_ENTRIES + 5):
            self.service._store((f"q{index}", "", 1), {"results": [], "hasNext": False})
        self.assertEqual(len(self.service._cache), gifs.CACHE_MAX_ENTRIES)
        self.assertIsNone(self.service._cached(("q0", "", 1)))

    def test_failures_are_not_cached(self):
        self.provider.error = gifs.ProviderError("timeout")
        self.search(query="cats")
        self.provider.error = None
        self.assertEqual(self.search(query="cats")["type"], "gif-results")
        self.assertEqual(len(self.provider.urls), 2)

    def test_rate_limit_per_device(self):
        for index in range(gifs.DEVICE_BURST):
            self.assertEqual(self.search(query=f"q{index}")["type"], "gif-results")
        self.assertEqual(self.search(query="one more")["code"], "rate_limited")
        # Кеш отвечает и после исчерпания лимита
        self.assertEqual(self.search(query="q0")["type"], "gif-results")
        # Другое устройство той же лицензии — свой лимит
        other = self.connect(device="device-alice-2")
        self.assertEqual(self.search(peer=other, query="fresh")["type"], "gif-results")
        # Запас восполняется со временем
        self.clock.value += 1 / gifs.DEVICE_REFILL_PER_SECOND + 0.1
        self.assertEqual(self.search(query="later")["type"], "gif-results")

    def test_build_from_environment_reads_key(self):
        import os
        from unittest import mock

        with mock.patch.dict(os.environ, {"JACKDAW_CALLS_GIF_API_KEY": " key-from-env "}, clear=False):
            os.environ.pop("JACKDAW_CALLS_GIF_API_KEY_FILE", None)
            service = gifs.build_gifs_from_environment()
        self.assertTrue(service.available)
        self.assertIn("/key-from-env/gifs/trending", service.build_url("", None, 1))
        with mock.patch.dict(os.environ, {"JACKDAW_CALLS_GIF_API_KEY": ""}, clear=False):
            os.environ.pop("JACKDAW_CALLS_GIF_API_KEY_FILE", None)
            self.assertFalse(gifs.build_gifs_from_environment().available)


class TokenBucketTests(unittest.TestCase):
    def test_refills_up_to_capacity(self):
        bucket = gifs.TokenBucket(2, 1.0, 0.0)
        self.assertTrue(bucket.take(0.0))
        self.assertTrue(bucket.take(0.0))
        self.assertFalse(bucket.take(0.5))
        self.assertTrue(bucket.take(1.0))
        bucket.take(100.0)
        self.assertLessEqual(bucket.tokens, 2)


if __name__ == "__main__":
    unittest.main()
