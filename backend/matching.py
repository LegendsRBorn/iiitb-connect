
import asyncio
import uuid
from collections import deque
from starlette.websockets import WebSocketDisconnect


async def safe_send(websocket, message):
    try:
        await websocket.send_json(message)
        return True

    except (WebSocketDisconnect, RuntimeError):
        return False


class MatchingEngine:

    def __init__(self):
        self.waiting_queue = deque()
        self.matches = {}
        self.user_matches = {}
        self.lock = asyncio.Lock()

    async def remove_from_queue(self, user_id):
        self.waiting_queue = deque(
            user for user in self.waiting_queue
            if user != user_id
        )

    async def find_match(self, user_id, connections):

        async with self.lock:

            # A user cannot enter multiple queues or matches.
            if user_id in self.user_matches:
                return

            if user_id in self.waiting_queue:
                return

            # Find another connected user.
            while self.waiting_queue:
                partner_id = self.waiting_queue.popleft()

                if partner_id == user_id:
                    continue

                if partner_id not in connections:
                    continue

                if partner_id in self.user_matches:
                    continue

                # Create a new match.
                match_id = str(uuid.uuid4())

                self.matches[match_id] = {
                    "users": {user_id, partner_id},
                    "accepted": set(),
                    "status": "pending"
                }

                self.user_matches[user_id] = match_id
                self.user_matches[partner_id] = match_id

                await connections[user_id].send_json({
                    "type": "match_found",
                    "match_id": match_id
                })

                await connections[partner_id].send_json({
                    "type": "match_found",
                    "match_id": match_id
                })

                return

            # Nobody is available.
            self.waiting_queue.append(user_id)

            await connections[user_id].send_json({
                "type": "waiting"
            })

    async def respond_to_match(
        self, user_id, match_id, accepted, connections
    ):

        async with self.lock:

            match = self.matches.get(match_id)

            if not match or user_id not in match["users"]:
                return

            if match["status"] != "pending":
                return

            if not accepted:

                for participant in match["users"]:
                    self.user_matches.pop(participant, None)

                    if participant in connections:
                        await connections[participant].send_json({
                            "type": "match_rejected"
                        })

                self.matches.pop(match_id, None)
                return

            match["accepted"].add(user_id)

            partner_id = next(
                participant
                for participant in match["users"]
                if participant != user_id
            )

            if partner_id in connections:
                await connections[partner_id].send_json({
                    "type": "match_accepted",
                    "match_id": match_id
                })

            # Both users must accept.
            if match["accepted"] == match["users"]:

                match["status"] = "active"

                initiator_id = min(match["users"])

                for participant in match["users"]:

                    await safe_send(
                        connections[participant],
                        {
                            "type": "match_ready",
                            "match_id": match_id,
                            "initiator": participant == initiator_id
                        }
                    )

    async def end_match(self, user_id, connections):

        async with self.lock:

            match_id = self.user_matches.get(user_id)

            if not match_id:
                await self.remove_from_queue(user_id)

                if user_id in connections:
                    await connections[user_id].send_json({
                        "type": "idle"
                    })

                return

            match = self.matches.pop(match_id, None)

            if not match:
                return

            for participant in match["users"]:
                self.user_matches.pop(participant, None)

                if participant in connections:
                    await safe_send(
                        connections[participant],
                        {
                            "type": "match_ended",
                            "reason": "participant_disconnected"
                            if participant != user_id
                            else "you_disconnected"
                        }
                    )
    async def get_active_partner(self, user_id, match_id):

        async with self.lock:

            match = self.matches.get(match_id)

            if not match:
                return None

            if match["status"] != "active":
                return None

            if user_id not in match["users"]:
                return None

            partner_id = next(
                participant
                for participant in match["users"]
                if participant != user_id
            )

            return partner_id
