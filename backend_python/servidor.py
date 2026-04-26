import cv2
import mediapipe as mp
import asyncio
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI()

# Permitimos que nuestro frontend en Vercel o localhost se conecte
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

mp_hands = mp.solutions.hands
mp_drawing = mp.solutions.drawing_utils

# Configuramos MediaPipe para una sola mano y alta velocidad
hands = mp_hands.Hands(
    max_num_hands=1,
    min_detection_confidence=0.7,
    min_tracking_confidence=0.5
)

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    
    # 640x480 es perfecto para la Acer
    cap = cv2.VideoCapture(0)
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)
    
    print("Cliente Web conectado al Dojo.")
    
    try:
        while cap.isOpened():
            success, image = cap.read()
            if not success: 
                break

            # Espejamos la imagen para que parezca un espejo (más intuitivo para jugar)
            image = cv2.flip(image, 1)
            image_rgb = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
            
            # Procesamos la imagen con MediaPipe
            results = hands.process(image_rgb)

            if results.multi_hand_landmarks:
                for hand_landmarks in results.multi_hand_landmarks:
                    # Dibujamos el esqueleto para la pantalla local (la que ve el jurado)
                    mp_drawing.draw_landmarks(
                        image, 
                        hand_landmarks, 
                        mp_hands.HAND_CONNECTIONS,
                        mp_drawing.DrawingSpec(color=(0, 140, 255), thickness=2, circle_radius=4), # Naranja
                        mp_drawing.DrawingSpec(color=(255, 255, 255), thickness=2, circle_radius=2)
                    )

                    # Extraemos el punto 8 (Punta del dedo índice)
                    dedo_indice = hand_landmarks.landmark[8]
                    
                    # Las coordenadas en MediaPipe son relativas (0.0 a 1.0)
                    # Las enviamos tal cual al frontend, y allá las multiplicamos por el ancho/alto de la pantalla
                    await websocket.send_json({
                        "x": dedo_indice.x,
                        "y": dedo_indice.y
                    })
            
            # Mostramos la ventana local para "vender" el concepto en la feria
            cv2.imshow('Jutsu Vision: Python Bridge', image)
            if cv2.waitKey(1) & 0xFF == ord('q'):
                break
            
            # Pausa pequeñísima para ceder el control al event loop de asyncio
            await asyncio.sleep(0.01) 
            
    except WebSocketDisconnect:
        print("El cliente Web se desconectó.")
    except Exception as e:
        print(f"Error inesperado: {e}")
    finally:
        cap.release()
        cv2.destroyAllWindows()
