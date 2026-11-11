
import {
    useCallback,
    useEffect,
    useRef,
    useState
} from "react";

export type ServerMessage = {
    type: string;
    user_id?: string;
    match_id?: string;
    reason?: string;
};

export function useSocket(
    onMessage: (message: ServerMessage) => void
) {
    const socketRef = useRef<WebSocket | null>(null);

    const [connected, setConnected] = useState(false);

    useEffect(() => {

        const protocol =
            window.location.protocol === "https:" ? "wss:" : "ws:";

        const socket = new WebSocket(
            `${protocol}//${window.location.hostname}:8000/ws`
        );

        socketRef.current = socket;

        socket.onopen = () => {
            setConnected(true);
        };

        socket.onmessage = (event) => {
            const message: ServerMessage =
                JSON.parse(event.data);

            onMessage(message);
        };

        socket.onclose = () => {
            setConnected(false);
        };

        socket.onerror = () => {
            setConnected(false);
        };

        return () => {
            socket.close();
            socketRef.current = null;
        };

    }, [onMessage]);

    const sendMessage = useCallback((message: object) => {

        if (socketRef.current?.readyState === WebSocket.OPEN) {
            socketRef.current.send(JSON.stringify(message));
        }

    }, []);

    return {
        connected,
        sendMessage
    };
}
