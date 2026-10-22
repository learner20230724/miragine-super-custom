package miragine3d_fla
{
   import adobe.utils.*;
   import flash.accessibility.*;
   import flash.desktop.*;
   import flash.display.*;
   import flash.errors.*;
   import flash.events.*;
   import flash.external.*;
   import flash.filters.*;
   import flash.geom.*;
   import flash.globalization.*;
   import flash.media.*;
   import flash.net.*;
   import flash.net.drm.*;
   import flash.printing.*;
   import flash.profiler.*;
   import flash.sampler.*;
   import flash.sensors.*;
   import flash.system.*;
   import flash.text.*;
   import flash.text.engine.*;
   import flash.text.ime.*;
   import flash.ui.*;
   import flash.utils.*;
   import flash.xml.*;
   
   [Embed(source="/_assets/assets.swf", symbol="symbol238")]
   public dynamic class quitgame_64 extends MovieClip
   {
      
      public var never:SimpleButton;
      
      public var okay:SimpleButton;
      
      public function quitgame_64()
      {
         super();
         addFrameScript(0,this.frame1);
      }
      
      public function onClick(param1:*) : *
      {
         if(param1.currentTarget == this.never)
         {
            this.visible = false;
         }
         else
         {
            DragonForce(Object(root).game).stopEngine();
            MovieClip(root).gotoAndStop("title");
         }
      }
      
      internal function frame1() : *
      {
         this.okay.addEventListener("click",this.onClick);
         this.never.addEventListener("click",this.onClick);
      }
   }
}

