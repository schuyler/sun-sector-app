import React, { useState, useEffect, useRef } from "react";
import { Text, View, Dimensions } from "react-native";

import Canvas from "react-native-canvas";

import * as Location from "expo-location";
import { DeviceMotion, DeviceMotionMeasurement } from "expo-sensors";

import { styles } from "./style";
import { generateSolarTable, SolarTable, SolarPosition } from "./solar";

const halfPI = Math.PI / 2;

function toDegrees(radians: number) {
  return (radians * 180) / Math.PI;
}

function SolarReadout(props: { position: SolarPosition | undefined }) {
  function padTime(n: number | undefined) {
    if (n == undefined) {
      return "--";
    }
    return n.toString().padStart(2, "0");
  }

  function formatTime(date: Date | undefined) {
    return padTime(date?.getHours()) + ":" + padTime(date?.getMinutes());
  }

  return (
    <View style={styles.container}>
      <Text style={styles.paragraph}>{formatTime(props.position?.time)}</Text>
      <Text style={styles.paragraph}>
        ☀️ {props.position?.elevation || "--"}º
      </Text>
    </View>
  );
}

function Heading(props: { heading: number }) {
  const abbreviations = [
    "N",
    "NNE",
    "NE",
    "ENE",
    "E",
    "ESE",
    "SE",
    "SSE",
    "S",
    "SSW",
    "SW",
    "WSW",
    "W",
    "WNW",
    "NW",
    "NNW",
  ];

  function abbreviate(angle: number) {
    return abbreviations[Math.floor(angle / (360 / abbreviations.length))];
  }

  return (
    <View style={styles.container}>
      <Text style={styles.paragraph}>{abbreviate(props.heading)}</Text>
      <Text style={styles.paragraph}>{props.heading.toFixed(0)}º</Text>
    </View>
  );
}

export default function App() {
  const [location, setLocation] = useState<Location.LocationObjectCoords>();
  const [orientation, setOrientation] = useState({ heading: 0, pitch: 0 });
  const [solarPosition, setSolarPosition] = useState<SolarPosition>();
  const [_errorMsg, setErrorMsg] = useState("");
  const subscriptions: { remove: () => void }[] = [];

  let motionReading: DeviceMotionMeasurement,
    compassReading: Location.LocationHeadingObject;
  let solarTable: SolarTable;

  const updateOrientation = () => {
    if (!motionReading || !compassReading || !solarTable) return;

    const { beta, gamma } = motionReading.rotation;
    const azimuth = compassReading.trueHeading;

    // Make pitch be 0º at the horizon and +/- depending on up or down
    // This math requires orientation close to portrait. Would be nice
    // to make it more resilient to roll axis.
    const upwards = Math.abs(gamma) > halfPI;
    const absBeta = Math.abs(beta);
    const pitch = toDegrees(upwards ? halfPI - absBeta : absBeta - halfPI);

    // For whatever reason the magnetometer flips orientation when
    // the device pitches ~roughly~ 45º above the horizon?
    // TODO: Make sure this doesn't flap right around 45º elevation.
    let heading = pitch < 45 ? azimuth : (azimuth + 180) % 360;

    setOrientation({ pitch, heading });

    const tableEntry = Math.floor(heading);
    setSolarPosition(solarTable[tableEntry]);
  };

  const canvasRef = useRef<Canvas | null>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const window = Dimensions.get("window");
    canvas.height = window.height;
    canvas.width = window.width;

    return () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    };
  }, [canvasRef]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // console.log("translate canvas");

    const degPerPixel = canvas.height / 60; // assuming FOV=60º for now
    ctx.save();
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.fillStyle = "rgba(255, 255, 0, 1)";

    if (solarPosition) {
      ctx.beginPath();
      ctx.arc(
        0,
        (orientation.pitch - solarPosition.elevation) * degPerPixel,
        canvas.width / 8,
        0,
        2 * Math.PI
      );
      ctx.fill();
    }

    /*
    ctx.beginPath();
    ctx.moveTo(-canvas.width / 2, orientation.pitch * degPerPixel);
    ctx.lineTo(canvas.width / 2, orientation.pitch * degPerPixel);
    ctx.stroke();
    */
    const horizonHeight = 5;
    const horizonOffset = orientation.pitch * degPerPixel;
    ctx.fillStyle = "rgba(0, 0, 255, 1)";
    ctx.fillRect(
      -canvas.width / 2,
      horizonOffset - horizonHeight / 2,
      canvas.width,
      horizonHeight
    );

    ctx.restore();
  }, [orientation.pitch]);

  useEffect(() => {
    (async () => {
      let { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") {
        setErrorMsg("Permission to access location was denied");
        return;
      }

      // Get position fix (we only need it once)
      const lastKnownLocation = await Location.getLastKnownPositionAsync();
      if (!lastKnownLocation) {
        setErrorMsg("Can't determine last known location");
        return;
      }
      setLocation(lastKnownLocation.coords);
      if (!solarTable) {
        solarTable = generateSolarTable(lastKnownLocation.coords);
      }

      // Start watching the device's compass heading
      subscriptions.push(
        await Location.watchHeadingAsync((reading) => {
          compassReading = reading;
          updateOrientation();
        })
      );
    })();
    subscriptions.push(
      DeviceMotion.addListener((reading) => {
        motionReading = reading;
        updateOrientation();
      })
    );
    return () => {
      subscriptions.forEach((sub) => {
        sub.remove();
      });
    };
  }, []);

  return (
    <View style={styles.container}>
      <Canvas
        ref={canvasRef}
        style={{
          flex: 6,
          width: "100%",
          height: "100%",
          backgroundColor: "#000",
        }}
      />
      <View
        style={[
          styles.container,
          styles.widget,
          {
            flexDirection: "row",
            flexGrow: 1,
            alignItems: "stretch",
          },
        ]}
      >
        <Heading heading={orientation.heading} />
        <SolarReadout position={solarPosition} />
        <View style={styles.container}>
          <Text style={styles.paragraph}>
            ↕️ {orientation.pitch.toFixed()}º
          </Text>
        </View>
      </View>
      <View style={[styles.container, styles.widget, { alignSelf: "stretch" }]}>
        <Text style={{ ...styles.paragraph, fontSize: 16 }}>
          {location?.latitude.toFixed(4)}ºN &nbsp;
          {location?.longitude.toFixed(4)}ºE
        </Text>
      </View>
    </View>
  );
}
