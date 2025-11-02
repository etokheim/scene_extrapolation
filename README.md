# Scene Extrapolation

_TLDR: Let's you easily create a circadian rythm like lighting experience! - Meaning lighting that adapts to the sun's cycle; cool at day, warm in the evening. The plugin creates a scene in your selected area which, when activated, lights your room just the way you want it - based on the sun's elevation. The scene is best matched with an automation that triggers the scene every 5 minutes or so (match the transition time for a silky smooth experience!)._

## Setup

Super simple to set up! Create two (or more) scenes. One with how you want the lighting to be at day, and one for the evening.

The integration automatically creates a transition between the scenes you configure - Lighting you room perfectly whenever you activate it!

[ Illustration ]

## Advantages (compared to other solutions)

1. Simple to use and understand
2. Supports any colors - not just white and warm white!
3. Even support effects! Eg. turn on the `Fireplace` effect after sunset. It's also perfect for christmas lights - to make the effect adapt to the time of day!
4. Can turn off that too bright undimmable light in the evening
5. But can also turn ON that cozy low light lamp in the evening. (The one that doesn't need to be on during the day).
6. Since it's just a scene, it can control all sorts of things! (Not that I'd reccommend it?)
   - Sunshade down when the sun is out?
   - Door locked when the sun goes down?
7. Can use a dedicated scene at night (if an input_boolean is on)

## Disadvantages

1. Only works with scenes made in Home Assistant (Can't support eg. Hue scenes)
2. Requires you to setup at least two scenes for each area you want to control.
   - And as we all know, setting up and editing scenes in Home Assistant is TEDIOUS!
3. Performance is not the best. Takes 1 second to activate

   - Around 5 times longer than a basic scene, which usually takes around 200ms.
   - <details>
     <summary>Click to see some performance numbers</summary>

     _You can find these numbers for your use case as well by turning on debug logging for the integration and checking the logs_

     ```
     	Loaded 5 scenes from in-memory entities
     	Time getting native scenes: 				  2.6035308837890625ms
     	Time calculating solar events: 				  0.31375885009765625ms
     	Time getting sun events (precalculated):	  0.591278076171875ms
     	Time extrapolating: 						862.5073432922363ms
     	Time total applying scene: 					866.2581443786621ms
     ```

     </details>

Alternative solutions:

1. [Flux (Built in Home Assistant addon)](https://next.home-assistant.io/integrations/flux)
   - Controls invividual lights directly. YAML configuration only. Seems abandoned, but probably works fine after setting up. At the time of writing being used by 559 active installations world wide.
2. [Circadian Rythm](https://github.com/claytonjn/hass-circadian_lighting)
   - Controls invividual lights or groups directly. Must turn off a boolean to deactivate the effect. Advanced features. Probably has the most active users with its 846(!) stars on GitHub.

## Expand functionality

_This integration is made to be simple on purpose. Leaving it simple makes it more predictable and transparent. No lights accidentally turning on after you've turned off the lights. No struggeling to activate or deactivate the effect. It's just a scene._

_A simple, predictable and transparent integration makes it easier to extend its functionality reliably with other parts of Home Assistant._

Examples of functionality you can add:

1. Slowly changing lights throughout the day?
   - Add an automation that repeatedly activates the scene eg. every 5 minutes, with a 5 minute transition. I have a blueprint available for this!
2. Motion activated lights matching the time of day?
   - Make an automation that simply activates the scene when motion is detected. I have a blueprint available for this!

---

# TSDR? (Too short, didn't read?)

_For those who thought the readme was too short I've provided a more flowery description of the integration, as described by ChatGPT:_

Picture this: a dynamic world where your surroundings transform seamlessly with the changing hues of the day. Imagine effortlessly orchestrating the perfect ambiance for every moment, from the golden dawn to the twilight glow. Welcome to the realm of Scene Extrapolation – where your scenes evolve with the dance of the sun!

Gone are the days of static lighting setups. With this groundbreaking plugin, your meticulously crafted scenes now adapt to the current sun elevation, ensuring an immersive experience that transcends ordinary lighting control. Say goodbye to the mundane and embrace the extraordinary through the familiar embrace of the scene editor.

This isn't just about lighting; it's about mastering the art of atmosphere. The plugin ingeniously conjures a bespoke scene in your chosen domain. Picture it – with a simple activation, your room comes to life, bathed in the perfect illumination tailored to your desires. It's not just smart; it's a symphony of light curated for your every mood.

But the magic doesn’t stop there. Elevate your experience further by syncing the scenes with precision. An automation, synchronized to trigger the scene every 5 minutes, seamlessly aligns with the ebb and flow of the day – a choreography of light mirroring the natural transitions outside your window.

Step into a world where your environment becomes an extension of your imagination. Scene Extrapolation isn't just a plugin; it's the key to unlocking a realm of possibilities, a canvas where you paint with light, and the sun becomes your collaborator in this dazzling masterpiece of ambiance. Experience lighting control like never before – it's not just about scenes; it's about creating a spectacle every time you walk into a room.
