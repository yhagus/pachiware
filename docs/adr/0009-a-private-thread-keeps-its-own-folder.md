# A private thread keeps its own folder

Minutes, Decisions, Notes and Documents kept from a private thread live under `channel/threads/<thread-id>/` in its parent channel's folder, and whoever asks for them must have been added to that thread. Before this they sat in the parent channel's own folders, so anyone who could view the parent could have the bot read a private thread's minutes; reading across channels would have widened that leak to the whole guild. A public thread keeps using its parent's folders, since everyone who views the parent views it.

Existing files moved only where their thread is recorded: Minutes (by the channel they were posted in) and Notes kept from messages (by their source links). Documents, Decisions and other Notes kept from a private thread before this stay in the parent's folders. A thread that can no longer be looked up counts as private, so its files are readable by nobody through the bot.

## Considered options

- **A `thread` field in each file's frontmatter.** Rejected: Decisions and Notes are written by the model through `writeFile`, which can leave the field out, and one missing field reopens the leak. A path cannot be forgotten.
