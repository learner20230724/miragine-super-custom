package dragonforce
{
   import dragonforce.core.Camera;
   import dragonforce.core.Library;
   import dragonforce.core.Scene;
   import dragonforce.renderEngine.DragonForceRenderEngine;
   import dragonforce.renderEngine.IRenderEngine;
   import dragonforce.utils.KeyManager;
   import flash.display.Sprite;
   import flash.events.Event;
   
   public class GameEngine extends Sprite
   {
      
      private var _scene:Scene;
      
      private var _camera:Camera;
      
      private var _render:IRenderEngine;
      
      private var _library:Library;
      
      private var _keyManager:KeyManager;
      
      private var _rendering:Boolean = false;
      
      public function GameEngine()
      {
         super();
         this._scene = new Scene();
         this._camera = new Camera();
         this._render = new DragonForceRenderEngine();
         this._library = new Library();
         this._keyManager = new KeyManager();
         addChild(this._scene);
         addEventListener(Event.ADDED_TO_STAGE,this.onAddedToStage);
      }
      
      private function onAddedToStage(param1:Event) : void
      {
         removeEventListener(Event.ADDED_TO_STAGE,this.onAddedToStage);
         this._keyManager.init(stage,false);
      }
      
      public function startEngine() : void
      {
         this.step();
         if(!this._rendering)
         {
            this._rendering = true;
            addEventListener(Event.ENTER_FRAME,this.step);
         }
      }
      
      public function stopEngine(param1:Boolean = false) : void
      {
         if(this._rendering)
         {
            this._rendering = false;
            removeEventListener(Event.ENTER_FRAME,this.step);
         }
         if(param1)
         {
            this.step();
         }
      }
      
      protected function step(param1:Event = null) : void
      {
         this._keyManager.step();
         this._scene.step();
         this._render.renderScene(this._scene,this._camera);
      }
      
      public function get scene() : Scene
      {
         return this._scene;
      }
      
      public function get camera() : Camera
      {
         return this._camera;
      }
      
      public function get library() : Library
      {
         return this._library;
      }
      
      public function get keyManager() : KeyManager
      {
         return this._keyManager;
      }
   }
}

