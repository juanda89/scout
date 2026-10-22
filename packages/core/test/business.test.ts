import { describe, expect, it } from "vitest";
import { businessSignals } from "../src/ingest/store.js";

describe("businessSignals", () => {
  it("detecta negocios por la bio aunque la bandera de Instagram esté apagada", () => {
    expect(businessSignals("¡Los Originales! 24Horas\n👇🏼PEDIDOS EN LÍNEA👇🏼", "CALIENTICOS & DELICIOSOS", "calienticosydeliciosos")?.confidence).toBeGreaterThanOrEqual(0.86);
    expect(businessSignals("Domicilios y pedidos por WhatsApp 📲 Sedes: Laureles y Envigado", "Pizzería Napoli", "napoli.pizza")?.confidence).toBeGreaterThanOrEqual(0.86);
    // "CEO @marca" sin más es solo apoyo: la decisión queda en Jev (que en este caso dice negocio al 0,87)
    expect(businessSignals("🎙️CEO @santiagocrrr\n🥤Los mejores Granizados en Col\n📍Castilla, Manrique, Belén y más", "EL COCTELAZO", "elcoctelazo")?.confidence).toBe(0.6);
  });
  it("no marca a una foodie", () => {
    expect(businessSignals("Aquí verás donde comer, donde comprar y muchas Eli aventuras más 😋\n📍de Medellín 🇨🇴 pa'l mundo 🌍\nContadora de historias", "Eliana Ospina", "elianaospina22")).toBeNull();
    expect(businessSignals("La vida es una sola y aquí la disfrutamos comiendo y viajando por montones", "Cesar / Foodies-Viajeros", "descubriendosaborescol")).toBeNull();
    // Una creadora con su propia marca sigue siendo creadora: "CEO @" solo apoya, no decide
    expect(businessSignals("Soy Carlos!! Amo comer, viajar y mostrarles mis experiencias 🌎 CEO @fresenatta | @grizzy_bgr 📍Medellín", "Carlos", "mimedellinsaborea")?.confidence ?? 0).toBeLessThan(0.7);
  });
});
