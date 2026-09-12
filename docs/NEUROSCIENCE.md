# Drosophila Connectome & Biophysical Modeling Guide

## 1. Executive Scientific Overview

**Motion Badminton: Connectome Edition** integrates computational neuroscience with real-time physical interaction. The simulated opponent is driven not by heuristics or deep reinforcement learning heuristics dressed in biological terminology, but by an active **Leaky Integrate-and-Fire (LIF)** network simulation operating over the synaptic connectivity graph of the **Drosophila melanogaster Central Nervous System (Janelia MaleCNS v1.0)**.

```
+-----------------------------------------------------------------------------------+
|                            Drosophila Connectome Pipeline                         |
+-----------------------------------------------------------------------------------+
|  [ 3D Shuttle Kinematics ]                                                         |
|         |                                                                         |
|         v                                                                         |
|  [ Sensory Encoder ]  --->  Retinal Azimuth, Elevation, Looming Expansion (η)    |
|         |                                                                         |
|         v                                                                         |
|  [ Optic Lobe VPNs ]  --->  LC4, LC6, LC10, LPLC2 (Lobula Columnar Receptive)     |
|         |                                                                         |
|         v                                                                         |
|  [ Central Complex ]  --->  EPG Compass Ring Attractor, P-EN, P-FN, FB Columns    |
|         |                                                                         |
|         v                                                                         |
|  [ Premotor Hubs ]    --->  Lateral Accessory Lobe (LAL) & Reciprocal Inhibition   |
|         |                                                                         |
|         v                                                                         |
|  [ Descending Neurons] ---> DNa01/DNa02 (Steer), DNp01 (Thrust), DNb01/GF (Strike)|
|         |                                                                         |
|         v                                                                         |
|  [ Motor Decoder ]    --->  Continuous Flight Velocity (Vx, Vz) & Effector Swing  |
+-----------------------------------------------------------------------------------+
```

---

## 2. Connectome Circuit Architecture

The Drosophila sensorimotor connectome subcircuit models the sensorimotor loop bridging visual perception to flight control:

### A. Visual Projection Neurons (Optic Lobe / Lobula Complex)

- **LC4 (Lobula Columnar 4)**: Specialized looming detectors. Responds non-linearly to the angular expansion rate ($\eta(t) = \theta \cdot \dot{\theta}$) of approaching objects, mediating rapid collision detection and evasive steering.
- **LC6 (Lobula Columnar 6)**: Small looming and approaching target detectors with wide dendritic arborization, routing excitation into premotor takeoff and steering circuits.
- **LC10 (Lobula Columnar 10)**: High-acuity retinotopic target-tracking neurons. Arranged in ipsilateral azimuthal receptive fields ($-80^\circ$ to $0^\circ$ on the left; $0^\circ$ to $+80^\circ$ on the right), encoding shuttle angular position.
- **LPLC2 (Lobula Plate Lobula Columnar 2)**: Directionally tuned radial optical expansion detectors.

### B. Central Complex (CX) Compass & Path Integration

- **EPG (Ellipsoid body - Protocerebral bridge - Gall)**: 16 wedge ring-attractor neurons forming an internal compass heading representation.
- **Ring Inhibitory Interneurons (GABAergic)**: Mediate global feedback inhibition ensuring only a single localized bump of activity is sustained across the ring attractor.
- **P-EN (Protocerebral bridge - Ellipsoid body - Noduli)**: Angular velocity integrators that receive asymmetric optic flow and shift the EPG heading bump left or right.
- **P-FN & FB Columns (Fan-shaped Body)**: Columnar coordinate transformation neurons translating allocentric heading into egocentric motor steering vectors.

### C. Premotor Hubs & Descending Pathways (Brain $\rightarrow$ VNC)

- **LAL (Lateral Accessory Lobe)**: Bilateral premotor routing hubs with reciprocal GABAergic cross-inhibition, enforcing decisive left vs. right steering selection without motor chatter.
- **DNa01 & DNa02 (Descending Neurons a01/a02)**: Direct steering motor commands. Asymmetric population rate ($\Delta \text{DNa02} = \text{Rate}(\text{DNa02\_R}) - \text{Rate}(\text{DNa02\_L})$) drives lateral turning torque and velocity ($v_x$).
- **DNp01 (Descending Neuron p01)**: Flight initiation and forward power acceleration ($v_z$), gating aerodynamic wing thrust.
- **DNb01 & Giant Fiber (GF)**: High-threshold rapid motor strike triggers coordinating foreleg and wing strikes for racket contact.
- **MDN (Moonwalker Descending Neurons)**: Deceleration, braking, and backward recovery.

---

## 3. Biophysical Model & Equations

The simulation employs the **Leaky Integrate-and-Fire (LIF)** model with conductance-based synaptic transmission formulated in Shiu et al. (_Nature_ 2024):

### Membrane Potential Dynamics

For neuron $i$:
$$\tau_m \frac{dV_i(t)}{dt} = (V_{\text{rest}} - V_i(t)) + g_{i,\text{exc}}(t)(E_{\text{exc}} - V_i(t)) + g_{i,\text{inh}}(t)(E_{\text{inh}} - V_i(t)) + I_{\text{ext},i}(t) + I_{\text{bg}} + \xi_i(t)$$

Where:

- $\tau_m = 15.0\text{ ms}$ (Membrane time constant)
- $V_{\text{rest}} = -65.0\text{ mV}$ (Resting membrane potential)
- $V_{\text{reset}} = -70.0\text{ mV}$ (Reset potential post-spike)
- $V_{\text{thresh}} = -50.0\text{ mV}$ (Action potential threshold)
- $E_{\text{exc}} = 0.0\text{ mV}$ (Excitatory reversal potential - Acetylcholine)
- $E_{\text{inh}} = -80.0\text{ mV}$ (Inhibitory reversal potential - GABA / Glutamate)
- $\tau_{\text{ref}} = 2.5\text{ ms}$ (Absolute refractory period)
- $\xi_i(t) \sim \mathcal{N}(0, \sigma_{\text{noise}}^2)$ (Biological stochastic membrane noise)

### Synaptic Conductance & Spike Propagation

Synaptic conductances decay exponentially between spikes:
$$\frac{dg_{i,\text{exc}}(t)}{dt} = -\frac{g_{i,\text{exc}}(t)}{\tau_{\text{exc}}}, \quad \frac{dg_{i,\text{inh}}(t)}{dt} = -\frac{g_{i,\text{inh}}(t)}{\tau_{\text{inh}}}$$

When pre-synaptic neuron $j$ emits an action potential at time $t_k$:
$$g_{i,\text{exc}}(t_k^+) = g_{i,\text{exc}}(t_k^-) + w_{ji} \cdot G_{\text{syn}} \quad (\text{if } s_{ji} > 0)$$
$$g_{i,\text{inh}}(t_k^+) = g_{i,\text{inh}}(t_k^-) + w_{ji} \cdot G_{\text{syn}} \quad (\text{if } s_{ji} < 0)$$

Where $w_{ji}$ is the electron microscopy synapse count between neuron $j$ and $i$, $s_{ji} \in \{+1, -1\}$ is the neurotransmitter sign, and $G_{\text{syn}}$ is the global synaptic gain multiplier.

---

## 4. Optical Sensory Transduction

The 3D court position $(x_s, y_s, z_s)$ and velocity $(v_x, v_y, v_z)$ of the shuttle relative to the fly's head $(x_f, y_f, z_f)$ are transduced into retinal cues:

1. **Distance**:
   $$d = \sqrt{(x_s - x_f)^2 + (y_s - y_f)^2 + (z_s - z_f)^2}$$
2. **Retinal Azimuth & Elevation**:
   $$\theta = \text{atan2}(x_s - x_f, z_s - z_f) - \psi_{\text{fly}}$$
   $$\phi = \text{atan2}(y_s - y_f, \sqrt{(x_s - x_f)^2 + (z_s - z_f)^2})$$
3. **Looming Angular Expansion Rate**:
   $$\eta(t) = \frac{r_{\text{shuttle}}}{d^2} \cdot \max\left(0, -\frac{\vec{\Delta r} \cdot \vec{v}}{d}\right)$$
4. **LC10 Retinotopic Activation**:
   $$I_{\text{ext},\text{LC10}_i} = A_0 \cdot \exp\left( - \left[ \frac{(\theta - \theta_{0,i})^2}{2\sigma_\theta^2} + \frac{(\phi - \phi_{0,i})^2}{2\sigma_\phi^2} \right] \right) \cdot \frac{1}{\max(1, d)}$$

---

## 5. Descending Motor Decoding

Descending neuron firing rates $R_i(t)$ (computed via causal exponential smoothing $\tau_{\text{rate}} = 40\text{ ms}$) are decoded into continuous kinematics:

1. **Lateral Steering Velocity ($v_x$)**:
   $$v_x(t) = \text{clamp}\left( K_x \cdot \left[ \bar{R}(\text{DNa02}_R) - \bar{R}(\text{DNa02}_L) + 0.6(\bar{R}(\text{DNa01}_R) - \bar{R}(\text{DNa01}_L)) \right], -v_{\text{max}}, v_{\text{max}} \right)$$
2. **Longitudinal Surge Velocity ($v_z$)**:
   $$v_z(t) = \text{clamp}\left( K_z \cdot \left[ \bar{R}(\text{DNp01}) - 1.5\bar{R}(\text{MDN}) \right], -v_{z,\text{max}}, v_{z,\text{max}} \right)$$
3. **Racket Strike Trigger**:
   $$\text{Trigger Strike if } \max(R_{\text{DNb01}}, R_{\text{GF}}) > 18.0\text{ Hz} \text{ and } d < 2.4\text{ m}$$

---

## 6. Scientific Honesty & Boundaries

To preserve strict scientific integrity, we explicitly demarcate empirical neuroscience from computational adaptations:

| Component                        | Grounding                              | Description                                                                                                                 |
| :------------------------------- | :------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------- |
| **Connectome Adjacency Graph**   | **Empirical Biological Data**          | Derived directly from HHMI Janelia MaleCNS v1.0 and FlyWire EM segmentations. Synapse counts and neuron IDs are authentic.  |
| **Neurotransmitter Assignments** | **Empirical Prediction / Literature**  | Signs (+1 ACh, -1 GABA/Glu) derived from Janelia RNA-seq / machine learning neurotransmitter predictions.                   |
| **LIF Neural Simulation**        | **Computational Approximation**        | Point-neuron Leaky Integrate-and-Fire model based on Shiu et al. (2024), abstracting multicompartmental dendritic geometry. |
| **Sensory Encoder**              | **Biophysically Grounded Model**       | Maps 3D shuttle kinematics to known optical receptive fields and looming response curves ($\eta$).                          |
| **Motor Embodiment**             | **Engineered Bio-Cybernetic Effector** | Maps descending motor population rates into badminton court navigation and cyber-racket strikes.                            |
