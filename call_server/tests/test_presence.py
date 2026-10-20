import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import calls  # noqa: E402
import presence  # noqa: E402
from test_calls import HubTestCase  # noqa: E402


TEAM = "team@example.com"
OTHER_TEAM = "sales@example.com"
TAG = "a" * 64
TAG_2 = "b" * 64


class WallClock:
    def __init__(self):
        self.value = 1_800_000_000.0

    def __call__(self):
        return self.value


class PresenceTestCase(HubTestCase):
    def setUp(self):
        super().setUp()
        self.wall = WallClock()
        self.presence = presence.PresenceService(scheduler=self.scheduler, clock=self.clock, wall_clock=self.wall)
        self.hub.presence = self.presence
        # Разные устройства и учётные данные: коллеги не знают лицензий друг друга
        self.alice = self.member("device-alice-1", ["alice@example.com", TEAM], "Alice")
        self.bob = self.member("device-trial-01", ["bob@example.com", TEAM], "Bob", kind="trial")
        self.mallory = self.member("device-bob-0001", ["mallory@example.com", OTHER_TEAM], "Mallory")

    def member(self, device, emails, name, kind="license"):
        peer = self.connect(device=device, emails=emails, name=name, kind=kind)
        self.hub.handle(peer, {"type": "presence-watch", "mailboxes": [e for e in emails if e in (TEAM, OTHER_TEAM)]})
        return peer

    def set(self, peer, state, tag=TAG, mailbox=TEAM, **extra):
        self.hub.handle(peer, {"type": "presence-set", "mailbox": mailbox, "tag": tag, "state": state, **extra})

    @staticmethod
    def updates(peer):
        return [m for m in peer.inbox if m["type"] == "presence"]


class PresenceFlowTests(PresenceTestCase):
    def test_watch_returns_snapshot_only_for_own_mailboxes(self):
        self.assertEqual(self.last(self.alice, "presence-snapshot"), {"type": "presence-snapshot", "mailboxes": {TEAM: []}})
        self.hub.handle(self.mallory, {"type": "presence-watch", "mailboxes": [TEAM, OTHER_TEAM, "bad"]})
        self.assertEqual(self.last(self.mallory, "presence-snapshot")["mailboxes"], {OTHER_TEAM: []})

    def test_colleague_sees_viewing_and_replying(self):
        self.set(self.alice, "viewing", **{"from": "alice@example.com"})
        update = self.last(self.bob, "presence")
        self.assertEqual(update["mailbox"], TEAM)
        self.assertEqual(update["tag"], TAG)
        self.assertEqual(update["state"], "viewing")
        self.assertEqual(update["name"], "Alice")
        self.assertEqual(update["email"], "alice@example.com")
        self.assertEqual(update["at"], 1_800_000_000)
        self.set(self.alice, "replying", **{"from": "alice@example.com"})
        self.assertEqual(self.last(self.bob, "presence")["state"], "replying")
        # Своё устройство о себе не узнаёт
        self.assertEqual(self.updates(self.alice), [])

    def test_refresh_does_not_broadcast(self):
        self.set(self.alice, "viewing")
        self.clock.value += 60
        self.set(self.alice, "viewing")
        self.assertEqual(len(self.updates(self.bob)), 1)

    def test_clear_removes_state(self):
        self.set(self.alice, "viewing")
        self.set(self.alice, "none")
        self.assertEqual(self.last(self.bob, "presence")["state"], "none")
        self.hub.handle(self.bob, {"type": "presence-watch", "mailboxes": [TEAM]})
        self.assertEqual(self.last(self.bob, "presence-snapshot")["mailboxes"], {TEAM: []})
        # Повторное снятие ничего не рассылает
        count = len(self.updates(self.bob))
        self.set(self.alice, "none")
        self.assertEqual(len(self.updates(self.bob)), count)

    def test_snapshot_contains_colleagues_current_state(self):
        self.set(self.alice, "replying")
        self.hub.handle(self.bob, {"type": "presence-watch", "mailboxes": [TEAM]})
        entries = self.last(self.bob, "presence-snapshot")["mailboxes"][TEAM]
        self.assertEqual([(e["tag"], e["state"], e["name"]) for e in entries], [(TAG, "replying", "Alice")])
        self.hub.handle(self.alice, {"type": "presence-watch", "mailboxes": [TEAM]})
        self.assertEqual(self.last(self.alice, "presence-snapshot")["mailboxes"][TEAM], [])

    def test_replied_survives_disconnect_and_replaces_replying(self):
        self.set(self.alice, "replying")
        self.wall.value += 90
        self.set(self.alice, "replied")
        update = self.last(self.bob, "presence")
        self.assertEqual((update["state"], update["at"]), ("replied", 1_800_000_090))
        self.assertEqual(self.presence.active, {})
        self.hub.disconnected(self.alice)
        self.hub.handle(self.bob, {"type": "presence-watch", "mailboxes": [TEAM]})
        entries = self.last(self.bob, "presence-snapshot")["mailboxes"][TEAM]
        self.assertEqual([e["state"] for e in entries], ["replied"])
        self.clock.value += presence.REPLIED_TTL_SECONDS
        self.hub.handle(self.bob, {"type": "presence-watch", "mailboxes": [TEAM]})
        self.assertEqual(self.last(self.bob, "presence-snapshot")["mailboxes"][TEAM], [])

    def test_disconnect_clears_active_states(self):
        self.set(self.alice, "viewing")
        self.set(self.alice, "replying", tag=TAG_2)
        self.hub.disconnected(self.alice)
        cleared = {(m["tag"], m["state"]) for m in self.updates(self.bob)[-2:]}
        self.assertEqual(cleared, {(TAG, "none"), (TAG_2, "none")})
        self.assertEqual(self.presence.active, {})
        self.assertNotIn(self.alice, self.presence.watching)

    def test_ttl_expires_without_refresh(self):
        self.set(self.alice, "viewing")
        self.clock.value += presence.ACTIVE_TTL_SECONDS
        self.scheduler.fire(presence.SWEEP_INTERVAL_SECONDS)
        self.assertEqual(self.last(self.bob, "presence")["state"], "none")
        self.assertEqual(self.presence.active, {})

    def test_sweep_keeps_running_while_states_live(self):
        self.set(self.alice, "viewing")
        self.scheduler.fire(presence.SWEEP_INTERVAL_SECONDS)
        self.assertEqual(self.last(self.bob, "presence")["state"], "viewing")
        self.assertIsNotNone(self.presence._sweep_handle)

    def test_unwatching_mailbox_clears_states(self):
        self.set(self.alice, "viewing")
        self.hub.handle(self.alice, {"type": "presence-watch", "mailboxes": []})
        self.assertEqual(self.last(self.bob, "presence")["state"], "none")
        self.set(self.alice, "viewing")
        self.assertEqual(self.last(self.alice)["code"], "presence_not_member")

    def test_per_peer_limit_evicts_oldest(self):
        tags = [f"{i:064x}" for i in range(presence.MAX_ACTIVE_PER_PEER + 1)]
        for tag in tags:
            self.clock.value += 1
            self.set(self.alice, "viewing", tag=tag)
        live = {tag for by_tag in self.presence.active.values() for tag in by_tag}
        self.assertEqual(len(live), presence.MAX_ACTIVE_PER_PEER)
        self.assertNotIn(tags[0], live)

    def test_replied_per_mailbox_limit(self):
        for i in range(presence.MAX_REPLIED_PER_MAILBOX + 3):
            self.alice.rate.clear()
            self.set(self.alice, "replied", tag=f"{i:064x}")
        self.assertEqual(len(self.presence.replied[TEAM]), presence.MAX_REPLIED_PER_MAILBOX)
        self.assertNotIn(f"{0:064x}", self.presence.replied[TEAM])


class PresenceAccessTests(PresenceTestCase):
    def test_foreign_mailbox_is_rejected_like_unknown(self):
        self.set(self.mallory, "viewing")
        foreign = self.last(self.mallory)
        self.set(self.mallory, "viewing", mailbox="nobody@example.com")
        unknown = self.last(self.mallory)
        self.assertEqual(foreign["code"], "presence_not_member")
        self.assertEqual((foreign["code"], foreign["message"]), (unknown["code"], unknown["message"]))
        self.assertEqual(self.updates(self.alice) + self.updates(self.bob), [])

    def test_foreign_mailbox_updates_do_not_leak(self):
        self.set(self.alice, "replying")
        self.set(self.mallory, "viewing", mailbox=OTHER_TEAM)
        self.assertEqual(self.updates(self.mallory), [])
        self.assertEqual([m["mailbox"] for m in self.updates(self.bob)], [TEAM])

    def test_watch_needs_verified_address(self):
        self.hub.handle(self.mallory, {"type": "presence-watch", "mailboxes": [TEAM]})
        self.assertEqual(self.last(self.mallory, "presence-snapshot")["mailboxes"], {})
        self.set(self.alice, "viewing")
        self.assertEqual(self.updates(self.mallory), [])

    def test_requires_authentication(self):
        stranger = calls.Peer(lambda m: None)
        inbox = []
        stranger.send = inbox.append
        self.hub.handle(stranger, {"type": "presence-watch", "mailboxes": [TEAM]})
        self.assertEqual(inbox[-1]["code"], "not_authenticated")

    def test_reply_address_must_be_own_and_not_mailbox(self):
        self.set(self.alice, "viewing", **{"from": "bob@example.com"})
        self.assertEqual(self.last(self.bob, "presence")["email"], "")
        self.set(self.alice, "replying", **{"from": TEAM})
        self.assertEqual(self.last(self.bob, "presence")["email"], "")

    def test_rejects_bad_tag_and_state(self):
        self.set(self.alice, "viewing", tag="Subject: hello")
        self.assertEqual(self.last(self.alice)["code"], "invalid_presence")
        self.set(self.alice, "typing")
        self.assertEqual(self.last(self.alice)["code"], "invalid_presence")
        self.hub.handle(self.alice, {"type": "presence-watch", "mailboxes": "team@example.com"})
        self.assertEqual(self.last(self.alice)["code"], "invalid_presence")

    def test_rehello_resets_watch(self):
        self.set(self.alice, "viewing")
        proof = self.signer.issue("alice@example.com", "license:1")
        self.hub.handle(self.alice, {"type": "hello", "credential": {"kind": "license", "deviceId": "device-alice-1",
                                                                     "licenseKey": self.alice.credential_payload["licenseKey"]},
                                     "emailProofs": [proof], "name": "Alice"})
        self.assertEqual(self.last(self.bob, "presence")["state"], "none")
        self.assertNotIn(self.alice, self.presence.watching)
        self.hub.handle(self.alice, {"type": "presence-watch", "mailboxes": [TEAM]})
        self.assertEqual(self.last(self.alice, "presence-snapshot")["mailboxes"], {})

    def test_revoked_credential_clears_presence(self):
        self.set(self.alice, "viewing")
        self.hub.verifier.verify = lambda payload: (_ for _ in ()).throw(calls.CallError("license_inactive", "x"))
        self.clock.value += calls.CREDENTIAL_RECHECK_SECONDS
        self.set(self.alice, "viewing", tag=TAG_2)
        self.assertEqual(self.last(self.bob, "presence")["state"], "none")
        self.assertNotIn(self.alice, self.presence.watching)

    def test_rate_limit(self):
        for _ in range(calls.RATE_LIMITS["presence-set"]):
            self.set(self.alice, "viewing")
        self.set(self.alice, "viewing")
        self.assertEqual(self.last(self.alice)["code"], "rate_limited")


if __name__ == "__main__":
    unittest.main()
