
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
import uuid

from matching import MatchingEngine, safe_send


app = FastAPI(title="IIITB Connect")

connections = {}
matching_engine = MatchingEngine()


@app.get("/")
async def home():
    return {"message": "IIITB Connect is running"}


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):

    await websocket.accept()

    # Temporary anonymous development identity.
    user_id = str(uuid.uuid4())

    connections[user_id] = websocket

    await websocket.send_json({
        "type": "connected",
        "user_id": user_id
    })

    try:

        while True:

            data = await websocket.receive_json()

            event = data.get("type")

            if event == "find":
                await matching_engine.find_match(
                    user_id, connections
                )

            elif event == "accept":
                await matching_engine.respond_to_match(
                    user_id,
                    data.get("match_id"),
                    True,
                    connections
                )

            elif event == "reject":
                await matching_engine.respond_to_match(
                    user_id,
                    data.get("match_id"),
                    False,
                    connections
                )

            elif event == "skip":
                await matching_engine.end_match(
                    user_id, connections
                )

            elif event == "cancel_search":
                await matching_engine.end_match(
                    user_id, connections
                )

            elif event in ["offer", "answer", "ice_candidate"]:

                match_id = data.get("match_id")

                partner_id = await matching_engine.get_active_partner(
                    user_id,
                    match_id
                )

                if partner_id and partner_id in connections:

                    message = {
                        "type": event,
                        "match_id": match_id
                    }

                    if event in ["offer", "answer"]:
                        message["sdp"] = data.get("sdp")

                    elif event == "ice_candidate":
                        message["candidate"] = data.get("candidate")

                    await safe_send(
                        connections[partner_id],
                        message
                    )

    except WebSocketDisconnect:

        await matching_engine.end_match(
            user_id, connections
        )

        connections.pop(user_id, None)
