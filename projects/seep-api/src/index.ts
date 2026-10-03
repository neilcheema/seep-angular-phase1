// Entry point the Functions runtime loads — importing each function file
// registers it via its own app.http(...) / app.timer(...) call as a side effect.
import './functions/me'
import './functions/games'
import './functions/cleanup'
