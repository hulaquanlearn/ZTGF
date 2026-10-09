module.exports={apps:[
  {name:'quizforge-web',script:'src/server.js',cwd:__dirname,instances:1,exec_mode:'fork',autorestart:true,max_memory_restart:'500M',env:{NODE_ENV:'production'}},
  {name:'quizforge-worker',script:'src/worker.js',cwd:__dirname,instances:1,exec_mode:'fork',autorestart:true,max_memory_restart:'500M',env:{NODE_ENV:'production'}}
]};
