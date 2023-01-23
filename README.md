# Time Tracker
Time Tracker plugin for Obsidian.

# 🤔 Usage
Time is tracked in Clients/Projects and tasks.
To get started tracking your time in a project, open up the note that you want to track your time in. Move the cursor to the area you want the tracker to reside in, and then open your command palette and execute the `Time Tracker: Insert Time Tracker` command.

When switching to live preview or reading mode, you will now see the time tracker you just inserted! Now, simply name the first task (or leave the box empty if you don't want to name it) and press the **Start** button. Once you're done with the thing you were doing, simply press the **End** button and the time you spent will be saved and displayed to you in the table.

# 👀 What it does
A time tracker is really just a special code block that stores information about the times you pressed the Start and End buttons on. Since time is tracked solely through timestamps, you can switch notes, close Obsidian or even shut down your device completely while the tracker is running! Once you come back, your time tracker will still be running. 

The tracker's information is stored in the code block as JSON data. The names, start times and end times of each task are stored. They're displayed neatly in the code block in preview or reading mode.

# 🛣️ Roadmap
Time Tracker is still in its early stages! There are a lot of plans for it, including:
- A setting to link tasks to corresponding daily notes automatically

# 🙏 Acknowledgements

